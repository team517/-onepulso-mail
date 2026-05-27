import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-static";

export default async function LandingPage() {
  // Lee el HTML estático generado a partir del diseño y lo renderiza tal cual.
  const filePath = path.join(process.cwd(), "public", "landing.html");
  const raw = await fs.readFile(filePath, "utf-8");

  // Extraemos solo lo que va dentro de <body> y el contenido de <style> para
  // injectarlo dentro del shell de Next sin duplicar <html>/<head>.
  const styleMatches = Array.from(raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g));
  const styles = styleMatches.map((m) => m[1]).join("\n");

  const headMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/);
  const linkTags = headMatch
    ? Array.from(headMatch[1].matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)).map((m) => m[0]).join("\n")
    : "";

  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : raw;

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: linkTags }} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </>
  );
}
