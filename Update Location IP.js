export default {
  async scheduled(event, env, ctx) {
    return await updateGatewayIP(env);
  },

  async fetch(req, env) {
    const result = await updateGatewayIP(env);
    return new Response(result);
  }
}

async function updateGatewayIP(env) {
  // Resolve DDNS hostname to IP
  const dns = await fetch(
    "https://cloudflare-dns.com/dns-query?name=qcy.ddns.net&type=A",
    {
      headers: { "accept": "application/dns-json" }
    }
  );

  const answer = await dns.json();
  const ip = answer.Answer?.[0]?.data;

  if (!ip) return "DNS lookup failed";

  const update = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/gateway/locations/${env.LOCATION_ID}`,
    {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        networks: [{ network: `${ip}/32` }]
      })
    }
  );

  const result = await update.text();
  return `Updated location to ${ip}\n\n${result}`;
}