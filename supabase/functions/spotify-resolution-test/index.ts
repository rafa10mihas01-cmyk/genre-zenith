// spotify-resolution-test — Resolve token via getUserAccessToken para cada owner duplicado
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getUserToken } from "../_shared/spotify-client.ts";

const EXPECTED: Record<string, string> = {
  "223kkcpliwfmurqsdn3e2uutq": "821cb0cc-001b-4d2f-a0c0-66cafe055e72", // 05
  "22km4cu2qxaxahei7mansie7q": "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "22navoyncyk67zwp2qg7vt7la": "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "22ng2pjzdb2tucin4324eh5cq": "821cb0cc-001b-4d2f-a0c0-66cafe055e72", // 05
  "31svfjqrk6nayh5d46kmffemqyhy": "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "31swa2xl3uawqijufmt3bc4vtvta": "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "4v4pfdsr9dxm3zxnktj1kawf0": "e9a23b28-a4cf-4386-ba26-7277f870952a", // 08
  "5dn9yc38yq6ri8n8w2hubk1ji": "e9a23b28-a4cf-4386-ba26-7277f870952a", // 08 (METRALHA DOS BAILES)
  "31goz5mop3omjdye64kwlcqfbjga": "e9a23b28-a4cf-4386-ba26-7277f870952a", // 08 (BAILE DO PERNA)
  "6p5z5stfg640xtjoobureeo3g": "821cb0cc-001b-4d2f-a0c0-66cafe055e72", // 05
  "americanow61": "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "feliguin25": "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "hu3m8z8sxtlrztuciwf4c1iiu": "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "moarazolet": "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "victor.zumpichiatte": "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "z4ox6sjcnfkjulzdqkwj6qcd0": "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const results = [];
  for (const [userId, expected] of Object.entries(EXPECTED)) {
    try {
      const { row } = await getUserToken(userId);
      results.push({
        spotify_user_id: userId,
        display_name: row.display_name,
        chosen_app_id: row.app_id,
        chosen_is_default: row.is_default,
        expected_app_id: expected,
        result: row.app_id === expected ? "PASS" : "FAIL",
      });
    } catch (e) {
      results.push({ spotify_user_id: userId, error: (e as Error).message, result: "ERROR" });
    }
  }
  const pass = results.filter((r: any) => r.result === "PASS").length;
  const fail = results.filter((r: any) => r.result !== "PASS").length;
  return new Response(JSON.stringify({ pass, fail, total: results.length, results }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
