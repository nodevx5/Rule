export default {
    // Cron trigger: runs automatically on schedule
    async scheduled(event, env, ctx) {
        return await updateGatewayIP(env);
    },

    // Fetch trigger: only run if path is /run
    async fetch(request, env) {
        const path = new URL(request.url).pathname;

        // Manual trigger: only /run executes updates
        if (path === "/run") {
            const result = await updateGatewayIP(env);
            return new Response(result);
        }

        // Default response for root or other paths (prevents accidental updates)
        return new Response("Worker online. Use /run or cron to execute updates.");
    }
};

// Extract first two octets: "123.45.67.89" → "123.45"
function getPrefix(ip) {
    if (!ip) return "";
    return ip.split(".").slice(0, 2).join(".");
}

// Validate if prefix matches any in VALID_IP (multi-line)
function isValidPrefix(ip, env) {
    const prefix = getPrefix(ip);
    const validList = env.VALID_IP.split("\n")
        .map(v => v.trim())
        .filter(v => v.length > 0);
    return validList.includes(prefix);
}

// Telegram helper
async function sendTelegram(env, text) {
    try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text
            })
        });
    } catch (err) {
        console.error("Telegram send failed:", err);
    }
}

async function updateGatewayIP(env) {
    const hostname = "qcy.ddns.net";
    let message = "";
    let ddnsIP = null;
    let cloudflareIP = null;
    let location = null;

    try {
        // 1️⃣ Resolve DDNS hostname
        const dnsResp = await fetch(
            `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
            { headers: { "accept": "application/dns-json" } }
        );
        const dnsData = await dnsResp.json();
        ddnsIP = dnsData.Answer?.[0]?.data;

        if (!ddnsIP) throw new Error("No IP returned from DDNS hostname");

        // 2️⃣ Check if DDNS IP prefix is valid
        if (!isValidPrefix(ddnsIP, env)) {
            message = `⚠️ DDNS IP ${ddnsIP} is NOT in allowed prefixes.\nUpdate blocked.`;
            await sendTelegram(env, message);
            return message;
        }

        // 3️⃣ Fetch all Cloudflare Gateway locations
        const resp = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/gateway/locations`,
            { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
        );
        const data = await resp.json();

        if (!resp.ok) throw new Error(JSON.stringify(data));

        location = data.result.find(
            loc => loc.name.trim() === env.LOCATION_NAME.trim()
        );

        if (!location) {
            message = `⚠️ Location '${env.LOCATION_NAME}' not found`;
            await sendTelegram(env, message);
            return message;
        }

        cloudflareIP = location.networks[0].network.split("/")[0];

        // 4️⃣ Compare IPs
        if (ddnsIP === cloudflareIP) {
            message = `ℹ️ No update needed. DDNS IP (${ddnsIP}) matches Cloudflare Gateway IP.`;
            return message;
        }

        // 5️⃣ Update Cloudflare location with full payload
        const payload = {
            name: location.name,
            networks: [{ network: `${ddnsIP}/32` }],
            client_default: location.client_default
        };

        const updateResp = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/gateway/locations/${location.id}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${env.CF_API_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        const updateResult = await updateResp.json();

        // Only **one Telegram message** per run
        if (updateResp.ok && updateResult.success) {
            message = `🛜 Updated Gateway IP from ${cloudflareIP} → ${ddnsIP}`;
        } else {
            message = `⚠️ Failed to update Gateway IP!\n${JSON.stringify(updateResult)}`;
        }

        await sendTelegram(env, message);
        return message;

    } catch (err) {
        message = `⚠️ Error updating Gateway IP: ${err.message}`;
        await sendTelegram(env, message);
        return message;
    }
}