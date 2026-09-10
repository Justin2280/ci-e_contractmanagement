import { describe, expect, it } from "vitest";
import { flattenFiles, nestedText, parseMime } from "@/lib/intake/nested-mail";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

function mime(): Buffer {
  const inner = [
    "From: Marco de Groot <mjh.degroot@mobilis.nl>",
    "To: Justin <j.deweert@ci-engineers.com>",
    "Subject: FW: Indexering CI-Engineers",
    "Date: Tue, 02 Dec 2025 06:13:03 +0000",
    'Content-Type: multipart/mixed; boundary="inner"',
    "",
    "--inner",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Beste Justin, in de bijlage de Indexering t/m wk. 44/2025.",
    "--inner",
    'Content-Type: application/pdf; name="Opdrachtbon 21118.pdf"',
    'Content-Disposition: attachment; filename="Opdrachtbon 21118.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--inner--",
    "",
  ].join("\r\n");
  const outer = [
    "From: Justin <j.deweert@ci-engineers.com>",
    "To: contracten@ci-engineers.com",
    "Subject: FW: Indexatie over 2025",
    'Content-Type: multipart/mixed; boundary="outer"',
    "",
    "--outer",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Zie bijgaand.",
    "--outer",
    "Content-Type: message/rfc822",
    "Content-Disposition: attachment",
    "",
    inner,
    "--outer",
    'Content-Type: image/png; name="logo.png"',
    'Content-Disposition: inline; filename="logo.png"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("png").toString("base64"),
    "--outer--",
    "",
  ].join("\r\n");
  return Buffer.from(outer, "utf8");
}

describe("nested mail parsing", () => {
  it("extracts nested message text and its pdf attachment, skipping inline images", async () => {
    const msg = await parseMime(mime());
    expect(msg.onderwerp).toBe("FW: Indexatie over 2025");
    expect(msg.bestanden).toHaveLength(0);
    expect(msg.berichten).toHaveLength(1);
    const inner = msg.berichten[0];
    expect(inner.onderwerp).toBe("FW: Indexering CI-Engineers");
    expect(inner.van).toContain("mjh.degroot@mobilis.nl");
    expect(inner.tekst).toContain("Indexering t/m wk. 44/2025");
    const files = flattenFiles(msg);
    expect(files).toHaveLength(1);
    expect(files[0].naam).toBe("Opdrachtbon 21118.pdf");
    expect(files[0].mime).toBe("application/pdf");
    expect(files[0].buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(files[0].pad).toEqual(["FW: Indexatie over 2025", "FW: Indexering CI-Engineers"]);
    const text = nestedText(msg);
    expect(text).toContain("--- Ingesloten bericht: FW: Indexering CI-Engineers");
    expect(text).toContain("Indexering t/m wk. 44/2025");
  });
});
