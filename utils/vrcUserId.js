function normalizeVrcUserInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const directMatch = raw.match(/^(usr_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{6,})$/);
  if (directMatch) return directMatch[1];

  const urlMatch = raw.match(
    /(?:https?:\/\/)?(?:www\.)?vrchat\.com\/home\/user\/([^/?#\s]+)/i
  );
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]).trim();

  return "";
}

module.exports = {
  normalizeVrcUserInput
};

