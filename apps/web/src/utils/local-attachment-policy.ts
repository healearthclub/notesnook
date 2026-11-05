/* Heal Earth integration: local attachment validation. GPL-3.0-or-later. */
export async function validateLocalAttachment(file: File) {
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("Attachments must be nonempty and smaller than 100 MB.");
  if (/\.(svg|html?|xhtml|m?js)$/i.test(file.name) || /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|.*javascript)/i.test(file.type)) throw new Error("Active web files are not supported as private Notes attachments.");
  const bytes = new Uint8Array(await file.slice(0,16).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (file.type === "application/pdf" && !text.startsWith("%PDF-")) throw new Error("The PDF contents do not match its file type.");
  if (file.type.startsWith("image/")) {
    const valid = file.type === "image/png" ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)
      : file.type === "image/jpeg" ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
      : file.type === "image/gif" ? /^GIF8[79]a/.test(text)
      : file.type === "image/webp" ? text.startsWith("RIFF") && text.slice(8,12)==="WEBP"
      : file.type === "image/avif" ? text.slice(4,8)==="ftyp" && /avif|avis/.test(text.slice(8)) : false;
    if (!valid) throw new Error("Use a valid PNG, JPEG, GIF, WebP, or AVIF image.");
  }
}
