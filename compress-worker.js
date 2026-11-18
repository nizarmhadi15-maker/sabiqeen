// ضغط ملفات PDF داخل المتصفح باستخدام Ghostscript (WebAssembly) — لا يُرفع الملف لأي خادم أثناء الضغط
const BASE = "https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/";
self.onmessage = async e => {
  const { data, level } = e.data;
  let total = 0;
  try {
    const mod = await import(BASE + "gs.mjs");
    const gs = await mod.default({
      locateFile: f => BASE + f,
      print: s => {
        let m = /through (\d+)/.exec(s); if (m) total = +m[1];
        m = /^Page (\d+)/.exec(s); if (m && total) self.postMessage({ progress: Math.min(99, Math.round(+m[1] / total * 100)) });
      },
      printErr: () => {}
    });
    self.postMessage({ progress: 1 });
    gs.FS.writeFile("in.pdf", new Uint8Array(data));
    gs.callMain(["-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4", `-dPDFSETTINGS=/${level === "screen" ? "screen" : "ebook"}`,
      "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sOutputFile=out.pdf", "in.pdf"]);
    const out = gs.FS.readFile("out.pdf");
    if (!out || out.length < 100) throw new Error("empty");
    self.postMessage({ ok: true, out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
