export default {
  async scheduled(event, env, ctx) {
    return await updateGatewayIP(env);
  },

  async fetch(req, env) {
    const result = await updateGatewayIP(env);
    return new Response(result);
  }
};

async function updateGatewayIP(env) {
  const hostname = "qcy.ddns.net";
  const timestamp = new Date().toISOString();
  let message = "";
  let ddnsIP;

  // 1️⃣ Resolve DDNS hostname
  try {
    const dns = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
      { headers: { "accept": "application/dns-json" } }
    );

    const answer = await dns.json();
    ddnsIP = answer.Answer?.[0]?.data;

    if (!ddnsIP) {
      throw new Error("No IP returned from DDNS hostname");
    }
  } catch (err) {
    message = `⚠️ NoIP hostname error for ${hostname}: ${err.message}`;
    await sendTelegram(env, message);
    return message;
  }

  // 2️⃣ Fetch current Cloudflare Gateway location IP
  let cloudflareIP;
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/gateway/locations/${env.LOCATION_ID}`,
      {
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const result = await resp.json();
    if (!resp.ok || !result.result?.networks?.[0]?.network) {
      throw new Error(`Unable to fetch current Cloudflare IP: ${JSON.stringify(result)}`);
    }

    // Extract IP without /32 suffix if present
    cloudflareIP = result.result.networks[0].network.split("/")[0];

  } catch (err) {
    message = `⚠️ Error fetching Gateway Loc IP: ${err.message}`;
    await sendTelegram(env, message);
    return message;
  }

  // 3️⃣ Compare IPs
  if (ddnsIP === cloudflareIP) {
    message = `ℹ️ No update needed. DDNS IP (${ddnsIP}) matches Cloudflare Gateway IP.`;
    return message; // no Telegram notification needed if you prefer silence
  }

  // 4️⃣ Update Cloudflare IP because they differ
  try {
    const updateResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/gateway/locations/${env.LOCATION_ID}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          networks: [{ network: `${ddnsIP}/32` }]
        })
      }
    );

    const updateResult = await updateResp.json();

    if (updateResp.ok) {
      message = `🛜 Updated Gateway IP from ${cloudflareIP} → ${ddnsIP}`;
    } else {
      message = `⚠️ Failed to update  Gateway IP!\n${JSON.stringify(updateResult)}`;
    }

    await sendTelegram(env, message);
    return message;

  } catch (err) {
    message = `⚠️ Error updating Gateway IP: ${err.message}`;
    await sendTelegram(env, message);
    return message;
  }
}

// Telegram helper function
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