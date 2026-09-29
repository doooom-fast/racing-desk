// Build a livery from N art layers + optional guide rectangles, and export paint / spec TGAs.
// P.config = path to a JSON config (ExtendScript has no JSON parser, so it is eval'd):
// { "template": "/path/Car.psd", "out": "/dir/", "name": "DOOOOM", "base": [10,10,10],
//   "layers": [ {"png": "...", "color": [r,g,b], "rough": 255|null, "name": "..."} ],  // bottom -> top
//   "guides": [ {"rect": [x0,y0,x1,y1], "name": "AD SPOT - ...", "color": [255,0,255]} ] }
// Guides live in a hidden group and are never exported; they are there to paint against later.
// Layer pixels are recoloured in place with Fill + Preserve Transparency (a clipped fill layer
// silently failed to clip in testing), and the same layer is copied into the spec map's green
// channel group at the requested roughness (255 = matte, low = glossy).
app.displayDialogs = DialogModes.NO; app.preferences.rulerUnits = Units.PIXELS;
function cID(s){ return charIDToTypeID(s); } function sID(s){ return stringIDToTypeID(s); }
var f = new File(P.config); f.open("r"); var cfg = eval("(" + f.read() + ")"); f.close();
function byName(set, n){ for (var i = 0; i < set.layers.length; i++) if (set.layers[i].name == n) return set.layers[i]; return null; }
function fillHere(c, preserve){ var d = new ActionDescriptor(); d.putEnumerated(cID("Usng"), cID("FlCn"), cID("Clr ")); var k = new ActionDescriptor();
  k.putDouble(cID("Rd  "), c[0]); k.putDouble(cID("Grn "), c[1]); k.putDouble(cID("Bl  "), c[2]); d.putObject(cID("Clr "), cID("RGBC"), k);
  d.putUnitDouble(cID("Opct"), cID("#Prc"), 100); d.putEnumerated(cID("Md  "), cID("BlnM"), cID("Nrml")); if (preserve) d.putBoolean(cID("PrsT"), true);
  executeAction(cID("Fl  "), d, DialogModes.NO); }
function tga(doc, p){ var o = new TargaSaveOptions(); o.resolution = TargaBitsPerPixels.TWENTYFOUR; o.rleCompression = false; o.alphaChannels = false; doc.saveAs(new File(p), o, true, Extension.LOWERCASE); }
for (var k = app.documents.length - 1; k >= 0; k--) app.documents[k].close(SaveOptions.DONOTSAVECHANGES);
var d = app.open(new File(cfg.template));
var pa = byName(d, "Paintable Area");
// Templates differ: the Lotus has "Main Car Body", the Nissan GTP has "Base Scheme". Anchor the
// base layer above whatever sits at the BOTTOM of Paintable Area rather than a fixed name.
var mcb = byName(pa, "Main Car Body") || byName(pa, "Base Scheme") || pa.layers[pa.layers.length - 1];
var spec = byName(d, "Custom Spec Map"), green = byName(spec, "Green Channel Roughness");
var base = d.artLayers.add(); base.name = "Base body colour";
if (mcb) { base.move(mcb, ElementPlacement.PLACEBEFORE); } else { base.move(pa, ElementPlacement.INSIDE); }
d.activeLayer = base; d.selection.selectAll(); fillHere(cfg.base, false); d.selection.deselect();
var above = base;
for (var i = 0; i < cfg.layers.length; i++) {
  var L = cfg.layers[i];
  var src = app.open(new File(L.png)); app.activeDocument = src;
  var lay = src.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING); src.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = d;
  lay.name = L.name; lay.move(above, ElementPlacement.PLACEBEFORE); above = lay;
  d.activeLayer = lay; d.selection.selectAll(); fillHere(L.color, true); d.selection.deselect();
  if (L.rough !== null && L.rough !== undefined) {
    var sp = lay.duplicate(green, ElementPlacement.PLACEATBEGINNING); sp.name = L.name + " - roughness " + L.rough; sp.visible = true;
    d.activeLayer = sp; d.selection.selectAll(); fillHere([L.rough, L.rough, L.rough], true); d.selection.deselect();
  }
}
var guides = null;
if (cfg.guides && cfg.guides.length) {
  guides = d.layerSets.add(); guides.name = "AD SPOTS (guides - never exported)";
  for (var g = 0; g < cfg.guides.length; g++) {
    var G = cfg.guides[g]; var gl = d.artLayers.add(); gl.move(guides, ElementPlacement.INSIDE); gl.name = G.name;
    var r = G.rect; d.activeLayer = gl; d.selection.select([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    fillHere(G.color || [255, 0, 255], false); d.selection.deselect(); gl.opacity = 50;
  }
  guides.visible = false;
}
d.saveAs(new File(cfg.out + "Livery_" + cfg.name + ".psd"), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
var toff = byName(d, "Turn Off Before Exporting TGA"); var vis = []; for (var i = 0; i < d.layers.length; i++) vis.push(d.layers[i].visible);
if (toff) toff.visible = false; spec.visible = false; pa.visible = true; if (guides) guides.visible = false;
// Stock content inside Paintable Area can sit ABOVE the new layers and cover them: the Nissan
// template ships its Car Patterns group visible. Hide pattern/scheme layers for the export.
var hidden = [];
for (var q = 0; q < pa.layers.length; q++) {
  var nm = pa.layers[q].name.toLowerCase();
  if ((nm.indexOf("pattern") >= 0 || nm.indexOf("color change") >= 0 || nm.indexOf("car decal") >= 0)
      && pa.layers[q].visible) { pa.layers[q].visible = false; hidden.push(pa.layers[q]); }
}
tga(d, cfg.out + "car_" + cfg.name + ".tga");
for (var i = 0; i < d.layers.length; i++) d.layers[i].visible = false; spec.visible = true;
tga(d, cfg.out + "car_spec_" + cfg.name + ".tga");
for (var h = 0; h < hidden.length; h++) hidden[h].visible = true;
for (var i = 0; i < d.layers.length; i++) d.layers[i].visible = vis[i];
"ok";
