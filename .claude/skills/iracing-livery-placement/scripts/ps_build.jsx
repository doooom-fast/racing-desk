// Build the livery PSD from an iRacing template and export paint / gray-fallback / spec TGAs.
// P.template  template PSD            P.art   art_uv_rgba.png from livery_uv.py render
// P.out       output dir (slash)      P.name  basename, e.g. DOOOOM -> car_DOOOOM.tga
// P.base      body RGB "10,10,10"     P.artcolor paint colour of art "10,10,10" (same = spec-only)
// P.fallback  art RGB for no-spec file "38,38,38" (85% black)
// P.rough     roughness for art in spec green channel (255 = matte)
// Group names below are the iRacing-standard template names; adjust if a template differs.
app.displayDialogs = DialogModes.NO; app.preferences.rulerUnits = Units.PIXELS;
function rgb(s){ var p = (s || "").split(","); return [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2])]; }
var BASE = rgb(P.base || "10,10,10"), ARTC = rgb(P.artcolor || "10,10,10"), FB = rgb(P.fallback || "38,38,38"), RO = parseFloat(P.rough || "255");
function byName(set, n){ for (var i = 0; i < set.layers.length; i++) if (set.layers[i].name == n) return set.layers[i]; return null; }
function cID(s){ return charIDToTypeID(s); } function sID(s){ return stringIDToTypeID(s); }
function fillSel(c){ var d = new ActionDescriptor(); d.putEnumerated(cID("Usng"), cID("FlCn"), cID("Clr ")); var k = new ActionDescriptor(); k.putDouble(cID("Rd  "), c[0]); k.putDouble(cID("Grn "), c[1]); k.putDouble(cID("Bl  "), c[2]); d.putObject(cID("Clr "), cID("RGBC"), k); d.putUnitDouble(cID("Opct"), cID("#Prc"), 100); d.putEnumerated(cID("Md  "), cID("BlnM"), cID("Nrml")); executeAction(cID("Fl  "), d, DialogModes.NO); }
function solidClip(c, name){ var desc = new ActionDescriptor(); var ref = new ActionReference(); ref.putClass(sID("contentLayer")); desc.putReference(cID("null"), ref); var lyr = new ActionDescriptor(); lyr.putString(cID("Nm  "), name); lyr.putBoolean(sID("group"), true); var type = new ActionDescriptor(); var col = new ActionDescriptor(); col.putDouble(cID("Rd  "), c[0]); col.putDouble(cID("Grn "), c[1]); col.putDouble(cID("Bl  "), c[2]); type.putObject(cID("Clr "), cID("RGBC"), col); lyr.putObject(cID("Type"), sID("solidColorLayer"), type); desc.putObject(cID("Usng"), sID("contentLayer"), lyr); executeAction(cID("Mk  "), desc, DialogModes.NO); var f = app.activeDocument.activeLayer; if (!f.grouped) f.grouped = true; return f; }   // "group" at creation is not always honoured; force the clip
function tga(doc, p){ var o = new TargaSaveOptions(); o.resolution = TargaBitsPerPixels.TWENTYFOUR; o.rleCompression = false; o.alphaChannels = false; doc.saveAs(new File(p), o, true, Extension.LOWERCASE); }
function png(doc, p){ var o = new PNGSaveOptions(); o.compression = 6; doc.saveAs(new File(p), o, true, Extension.LOWERCASE); }
for (var k = app.documents.length - 1; k >= 0; k--) app.documents[k].close(SaveOptions.DONOTSAVECHANGES);
var d = app.open(new File(P.template));
var art = app.open(new File(P.art)); app.activeDocument = art;          // duplicate() only works from the FRONTMOST doc
var L = art.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING); art.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = d;
var pa = byName(d, "Paintable Area"), mcb = byName(pa, "Main Car Body");
var base = d.artLayers.add(); base.name = "Base body colour"; base.move(mcb, ElementPlacement.PLACEBEFORE);
d.activeLayer = base; d.selection.selectAll(); fillSel(BASE); d.selection.deselect();
L.name = "Art - placed per panel"; L.move(base, ElementPlacement.PLACEBEFORE);
var spec = byName(d, "Custom Spec Map"), green = byName(spec, "Green Channel Roughness");
var S = L.duplicate(green, ElementPlacement.PLACEATBEGINNING); S.name = "Art - roughness"; S.visible = true;
if (RO < 255) { d.activeLayer = S; solidClip([RO, RO, RO], "Art roughness value"); }
d.activeLayer = L; var fa = solidClip(ARTC, "Art colour"); var fg = solidClip(FB, "Art colour - no-spec fallback"); fg.visible = false;
// Optional offset shadow / half-outline layer: P.shadow (rgba png), P.shadowcolor "r,g,b", P.shadowrough (0-255, low = shiny)
if (P.shadow) {
  var sd = app.open(new File(P.shadowfull || P.shadow)); app.activeDocument = sd;
  var SH = sd.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING); sd.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = d;
  SH.name = "Shadow - offset half-outline"; SH.move(base, ElementPlacement.PLACEBEFORE);   // above base, below art
  // recolour the shadow pixels in place (fill with Preserve Transparency) - a clipped fill on this layer did not clip
  d.activeLayer = SH; d.selection.selectAll();
  var fd = new ActionDescriptor(); fd.putEnumerated(cID("Usng"), cID("FlCn"), cID("Clr ")); var sc = rgb(P.shadowcolor || "197,80,45"); var kc = new ActionDescriptor();
  kc.putDouble(cID("Rd  "), sc[0]); kc.putDouble(cID("Grn "), sc[1]); kc.putDouble(cID("Bl  "), sc[2]); fd.putObject(cID("Clr "), cID("RGBC"), kc);
  fd.putUnitDouble(cID("Opct"), cID("#Prc"), 100); fd.putEnumerated(cID("Md  "), cID("BlnM"), cID("Nrml")); fd.putBoolean(cID("PrsT"), true);
  executeAction(cID("Fl  "), fd, DialogModes.NO); d.selection.deselect();
  if (P.knockout) {   // art footprint in body colour, above the full shadow and below the art ("black on top")
    var kd = app.open(new File(P.knockout)); app.activeDocument = kd;
    var KO = kd.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING); kd.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = d;
    KO.name = "Art footprint - body colour (hides shadow under art)"; KO.move(SH, ElementPlacement.PLACEBEFORE);
    d.activeLayer = KO; d.selection.selectAll(); var kf = new ActionDescriptor(); kf.putEnumerated(cID("Usng"), cID("FlCn"), cID("Clr ")); var kk = new ActionDescriptor();
    kk.putDouble(cID("Rd  "), BASE[0]); kk.putDouble(cID("Grn "), BASE[1]); kk.putDouble(cID("Bl  "), BASE[2]); kf.putObject(cID("Clr "), cID("RGBC"), kk);
    kf.putUnitDouble(cID("Opct"), cID("#Prc"), 100); kf.putEnumerated(cID("Md  "), cID("BlnM"), cID("Nrml")); kf.putBoolean(cID("PrsT"), true);
    executeAction(cID("Fl  "), kf, DialogModes.NO); d.selection.deselect();
  }
  // spec uses the trimmed shadow (shifted footprint minus footprint) so the body keeps template roughness under the art
  var SRC = SH;
  if (P.shadowfull) { var td = app.open(new File(P.shadow)); app.activeDocument = td; SRC = td.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING); td.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = d; }
  var SS = (P.shadowfull ? SRC : SH.duplicate(green, ElementPlacement.PLACEATBEGINNING));
  if (P.shadowfull) SS.move(green, ElementPlacement.PLACEATBEGINNING);
  SS.name = "Shadow - roughness"; SS.visible = true;
  S.move(SS, ElementPlacement.PLACEBEFORE);
  var sr = parseFloat(P.shadowrough || "15"); d.activeLayer = SS; solidClip([sr, sr, sr], "Shadow roughness value");
}
d.saveAs(new File(P.out + "Livery_" + P.name + ".psd"), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
var toff = byName(d, "Turn Off Before Exporting TGA"); var vis = []; for (var i = 0; i < d.layers.length; i++) vis.push(d.layers[i].visible);
if (toff) toff.visible = false; spec.visible = false; pa.visible = true;
tga(d, P.out + "car_" + P.name + ".tga"); png(d, P.out + "check_paint.png");
fa.visible = false; fg.visible = true; tga(d, P.out + "car_" + P.name + "_grayfallback.tga"); png(d, P.out + "check_paint_fallback.png"); fg.visible = false; fa.visible = true;
for (var i = 0; i < d.layers.length; i++) d.layers[i].visible = false; spec.visible = true;
tga(d, P.out + "car_spec_" + P.name + ".tga"); png(d, P.out + "check_spec.png");
for (var i = 0; i < d.layers.length; i++) d.layers[i].visible = vis[i];
"ok";
