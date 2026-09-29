// Rasterize vector art (.ai/.pdf/.eps) through Photoshop. Quick Look/qlmanage renders can DROP
// elements (it lost a whole text line once), so always rasterize with Photoshop.
// P.art = source, P.out = output PNG, P.dpi (default 600)
app.displayDialogs = DialogModes.NO;
var o = new PDFOpenOptions(); o.antiAlias = true; o.mode = OpenDocumentMode.RGB; o.bitsPerChannel = BitsPerChannelType.EIGHT;
o.resolution = parseInt(P.dpi || "600", 10); o.cropPage = CropToType.BOUNDINGBOX; o.suppressWarnings = true; o.usePageNumber = true; o.page = 1;
var a = app.open(new File(P.art), o); a.flatten();
var s = new PNGSaveOptions(); s.compression = 3; a.saveAs(new File(P.out), s, true, Extension.LOWERCASE);
a.close(SaveOptions.DONOTSAVECHANGES); "ok";
