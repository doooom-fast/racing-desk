"""Bake UV-space position / normal / panel maps for a car mesh. Runs INSIDE Blender.

    blender --background --factory-startup --python bake_uv_maps.py -- \
        --mesh car.blend --out templates/<car>/bake --resolution 2048

The mesh must carry the paint template's UV layout — that is the whole premise.
Name its materials after panels (``door.left``, ``hood``, ``rear_quarter.right``)
and the panel pass turns straight into profile zones.

Written against the Blender 3.x/4.x Python API and driven through
``livery bake``. It has not been run in this repo's CI (no Blender there), so the
first run on a new machine is worth doing with ``--resolution 512`` and then
``livery bake --check``, which verifies the maps decode and line up with the
template before any profile is derived from them.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy  # type: ignore  # provided by Blender
from mathutils import Vector  # type: ignore

PASS_POSITION = "position"
PASS_NORMAL = "normal"
PASS_PANELS = "panels"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Bake UV-space maps for a livery profile")
    parser.add_argument("--mesh", required=True, help=".blend/.obj/.fbx/.gltf containing the car")
    parser.add_argument("--out", required=True, help="directory to write the maps into")
    parser.add_argument("--resolution", type=int, default=2048)
    parser.add_argument("--uv-map", default=None, help="UV layer name (default: the active one)")
    parser.add_argument("--forward", default="+y", help="the mesh's forward axis")
    parser.add_argument("--up", default="+z", help="the mesh's up axis")
    parser.add_argument("--margin", type=int, default=4, help="bake margin in pixels")
    return parser.parse_args(argv)


def load_mesh(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path))
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if suffix == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=str(path))
        else:  # Blender 3.x
            bpy.ops.import_scene.obj(filepath=str(path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".dae":
        bpy.ops.wm.collada_import(filepath=str(path))
    else:
        raise SystemExit(f"unsupported mesh format: {suffix}")


def mesh_objects() -> list:
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objects:
        raise SystemExit("no mesh objects in the file")
    return objects


def world_bounds(objects) -> tuple[Vector, Vector]:
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    padding = Vector(((hi[i] - lo[i]) * 0.001 + 1e-4 for i in range(3)))
    return lo - padding, hi + padding


def make_image(name: str, resolution: int, alpha: bool = False):
    image = bpy.data.images.new(name, resolution, resolution, alpha=alpha, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.generated_color = (0.0, 0.0, 0.0, 0.0 if alpha else 1.0)
    return image


def emission_material(name: str, build_source):
    """A material whose surface emits whatever ``build_source`` wires up."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    build_source(nodes, links, emission)
    return mat


def position_material(lo: Vector, hi: Vector):
    def build(nodes, links, emission):
        geometry = nodes.new("ShaderNodeNewGeometry")
        separate = nodes.new("ShaderNodeSeparateXYZ")
        combine = nodes.new("ShaderNodeCombineXYZ")
        links.new(geometry.outputs["Position"], separate.inputs["Vector"])
        for axis, index in (("X", 0), ("Y", 1), ("Z", 2)):
            # Normalise each axis into 0-1 over the car's bounding box; the
            # exact bounds go in bake.json so the analyser can decode it.
            map_range = nodes.new("ShaderNodeMapRange")
            map_range.inputs["From Min"].default_value = lo[index]
            map_range.inputs["From Max"].default_value = hi[index]
            map_range.inputs["To Min"].default_value = 0.0
            map_range.inputs["To Max"].default_value = 1.0
            links.new(separate.outputs[axis], map_range.inputs["Value"])
            links.new(map_range.outputs["Result"], combine.inputs[axis])
        links.new(combine.outputs["Vector"], emission.inputs["Color"])

    return emission_material("_livery_position", build)


def normal_material():
    def build(nodes, links, emission):
        geometry = nodes.new("ShaderNodeNewGeometry")
        scale = nodes.new("ShaderNodeVectorMath")
        scale.operation = "MULTIPLY_ADD"
        scale.inputs[1].default_value = (0.5, 0.5, 0.5)
        scale.inputs[2].default_value = (0.5, 0.5, 0.5)
        links.new(geometry.outputs["Normal"], scale.inputs[0])
        links.new(scale.outputs["Vector"], emission.inputs["Color"])

    return emission_material("_livery_normal", build)


def flat_material(name: str, color: tuple[float, float, float]):
    def build(nodes, links, emission):
        emission.inputs["Color"].default_value = (*color, 1.0)

    return emission_material(name, build)


def panel_palette(objects) -> dict[str, tuple[int, int, int]]:
    """A distinct 8-bit colour per original material name."""
    names: list[str] = []
    for obj in objects:
        for slot in obj.material_slots:
            if slot.material and slot.material.name not in names:
                names.append(slot.material.name)
    palette: dict[str, tuple[int, int, int]] = {}
    for i, name in enumerate(sorted(names)):
        # Spread hues coarsely so decoding tolerates compression and margins.
        step = max(1, 255 // max(1, len(names)))
        palette[name] = ((i * step + 17) % 256, (i * 73 + 41) % 256, (i * 151 + 97) % 256)
    return palette


def assign_bake_target(objects, image, uv_map: str | None) -> None:
    for obj in objects:
        if uv_map and uv_map in obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers[uv_map]
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            node.select = True
            mat.node_tree.nodes.active = node


def bake_pass(objects, image, uv_map: str | None, margin: int) -> None:
    assign_bake_target(objects, image, uv_map)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="EMIT", use_clear=True, margin=margin)


def set_materials(objects, material) -> None:
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(material)


def main() -> None:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    load_mesh(Path(args.mesh))

    objects = mesh_objects()
    for obj in objects:
        if not obj.data.uv_layers:
            raise SystemExit(f"{obj.name} has no UV map — it cannot carry a paint template")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    scene.render.bake.use_selected_to_active = False

    lo, hi = world_bounds(objects)
    palette = panel_palette(objects)

    # Panels first, while the original material names are still on the mesh.
    if palette:
        panel_image = make_image(PASS_PANELS, args.resolution)
        original = {obj.name: [slot.material for slot in obj.material_slots] for obj in objects}
        for obj in objects:
            for slot in obj.material_slots:
                if slot.material:
                    color = tuple(c / 255.0 for c in palette[slot.material.name])
                    slot.material = flat_material(f"_livery_panel_{slot.material.name}", color)
        bake_pass(objects, panel_image, args.uv_map, args.margin)
        panel_image.filepath_raw = str(out / "panels.png")
        panel_image.file_format = "PNG"
        panel_image.save()
        for obj in objects:
            obj.data.materials.clear()
            for mat in original[obj.name]:
                obj.data.materials.append(mat)

    position_image = make_image(PASS_POSITION, args.resolution, alpha=True)
    set_materials(objects, position_material(lo, hi))
    bake_pass(objects, position_image, args.uv_map, args.margin)
    position_image.filepath_raw = str(out / "position.png")
    position_image.file_format = "PNG"
    position_image.save()

    normal_image = make_image(PASS_NORMAL, args.resolution)
    set_materials(objects, normal_material())
    bake_pass(objects, normal_image, args.uv_map, args.margin)
    normal_image.filepath_raw = str(out / "normal.png")
    normal_image.file_format = "PNG"
    normal_image.save()

    (out / "bake.json").write_text(
        json.dumps(
            {
                "position": "position.png",
                "normal": "normal.png",
                "panels": "panels.png" if palette else None,
                "bounds_min": [lo[0], lo[1], lo[2]],
                "bounds_max": [hi[0], hi[1], hi[2]],
                "forward": args.forward,
                "up": args.up,
                "resolution": args.resolution,
                "panel_names": {name: list(color) for name, color in palette.items()},
                "mesh": str(args.mesh),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"baked {len(objects)} object(s) → {out}")


if __name__ == "__main__":
    main()
