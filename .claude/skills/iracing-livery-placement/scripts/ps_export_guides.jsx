// Export every layer of an iRacing template's guide group, plus paint patterns, as PNGs.
// P.template = template PSD, P.out = output dir (trailing slash). Leaves the template open.
app.displayDialogs = DialogModes.NO;
for (var k = app.documents.length - 1; k >= 0; k--) app.documents[k].close(SaveOptions.DONOTSAVECHANGES);
var d = app.open(new File(P.template));
var log = "DOC " + d.width.as("px") + "x" + d.height.as("px") + "\n";
function png(name){ var o = new PNGSaveOptions(); o.compression = 3; d.saveAs(new File(P.out + name + ".png"), o, true, Extension.LOWERCASE); }
function allOff(set){ for (var i = 0; i < set.layers.length; i++) { set.layers[i].visible = false; } }
function dump(set, ind){ for (var i = 0; i < set.layers.length; i++) { var L = set.layers[i]; log += ind + (L.typename == "LayerSet" ? "[G] " : "") + L.name + "\n"; if (L.typename == "LayerSet") dump(L, ind + "  "); } }
dump(d, "");
var top = []; for (var i = 0; i < d.layers.length; i++) top.push(d.layers[i]);
for (var t = 0; t < top.length; t++) {
  var g = top[t]; if (g.typename != "LayerSet") continue;
  for (var j = 0; j < g.layers.length; j++) {
    var L = g.layers[j];
    allOff(d); g.visible = true; allOff(g); L.visible = true;
    if (L.typename == "LayerSet") { for (var m = 0; m < L.layers.length; m++) { allOff(L); L.layers[m].visible = true; png("grp_" + L.name.replace(/\W+/g,"_") + "__" + L.layers[m].name.replace(/\.tga$/,"").replace(/\W+/g,"_")); } for (var m2 = 0; m2 < L.layers.length; m2++) L.layers[m2].visible = false; }
    else png("g_" + L.name.replace(/\W+/g, "_"));
  }
}
var f = new File(P.out + "layers.txt"); f.open("w"); f.write(log); f.close(); "ok";
