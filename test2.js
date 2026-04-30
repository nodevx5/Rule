// Import all your modules
import * as fam from "./fam.js";

// Module registry
const modules = {
    fam: fam
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Clean routing path
        const segments = url.pathname
            .split("/")
            .filter(s => s.length > 0); // removes empty entries

        // === /run → run all modules ===
        if (segments.length === 1 && segments[0] === "run") {
            for (const modName in modules) {
                const mod = modules[modName];
                if (mod.handleScheduled) {
                    await mod.handleScheduled(null, env);
                }
            }
            return new Response("✅ All modules executed.");
        }

        // === /modulename/run → run specific module ===
        if (segments.length === 2 && segments[1] === "run") {
            const modName = segments[0].toLowerCase();
            const mod = modules[modName];

            if (!mod) {
                return new Response(`❌ Module '${modName}' not found.`, { status: 404 });
            }

            if (!mod.handleFetch) {
                return new Response(`❌ Module '${modName}' does not support handleFetch().`, { status: 400 });
            }

            return await mod.handleFetch(request, env);
        }

        // === Default response ===
        return new Response(
            "Worker online.\nUse /run to execute all modules or /modulename/run for individual modules."
        );
    },

    async scheduled(event, env, ctx) {
        // Run all modules on cron
        for (const modName in modules) {
            const mod = modules[modName];
            if (mod.handleScheduled) {
                ctx.waitUntil(mod.handleScheduled(event, env, ctx));
            }
        }
    }
};