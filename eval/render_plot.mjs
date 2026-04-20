import { JSDOM } from "jsdom";
import * as Plot from "@observablehq/plot";

const MARK_FNS = { lineY: Plot.lineY, barY: Plot.barY, dot: Plot.dot, areaY: Plot.areaY };

const chunks = [];
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => {
    const { config, rows } = JSON.parse(Buffer.concat(chunks).toString());
    const { document } = new JSDOM("<!DOCTYPE html><body></body>").window;

    const marks = (config.marks || []).map(m => {
        const { type, ...channels } = m;
        const fn = MARK_FNS[type];
        if (fn) {
            return fn(rows, channels);
        }
        process.stderr.write(`unknown mark type: ${type}\n`);
        return null;
    }).filter(Boolean);

    const { marks: _, ...rest } = config;

    try {
        const svg = Plot.plot({ marks, ...rest, document });
        document.body.appendChild(svg);
        // innerHTML gives proper HTML5 serialization; add xmlns for standalone .svg viewing
        let out = document.body.innerHTML;
        if (!out.includes("xmlns=")) {
            out = out.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `);
        }
        process.stdout.write(out);
    } catch (err) {
        process.stderr.write(`render error: ${err.message}\n`);
        process.exit(1);
    }
});
