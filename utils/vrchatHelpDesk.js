// utils/vrchatHelpDesk.js
//
// VRChat's help desk now requires a signed-in account to file a request, so the
// bot cannot submit moderation tickets on a moderator's behalf. Instead we build
// the report text and hand the moderator a link to the moderation form, which
// they submit themselves while signed in.

const MODERATION_FORM_URL =
  "https://help.vrchat.com/hc/en-us/requests/new?ticket_form_id=41536165070483";

// Single-line fields: collapse all whitespace.
function cleanLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Multi-line blocks: keep line breaks, tidy trailing spaces.
function cleanBlock(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function userProfileUrl(userId) {
  const id = cleanLine(userId);
  return id ? `https://vrchat.com/home/user/${encodeURIComponent(id)}` : "";
}

/**
 * Builds the text a moderator pastes into the VRChat moderation form.
 * Returns { url, subject, description, attachments }.
 */
function buildModerationReport(opts = {}) {
  const target = cleanLine(opts.target);
  const category = cleanLine(opts.category) || "Harassment";
  const reason = cleanBlock(opts.description) || "No description provided";
  const profile = userProfileUrl(opts.accountId || opts.target);

  const subject =
    cleanLine(opts.subject) || (target ? `Report: ${target}` : "VRChat moderation report");

  const header = [
    `Category: ${category}`,
    target ? `Reported user: ${target}` : "",
    opts.accountId ? `User ID: ${cleanLine(opts.accountId)}` : "",
    profile ? `Profile: ${profile}` : ""
  ].filter(Boolean);

  const lines = [...header, "", "Details:", reason];

  const attachments = (opts.attachments || [])
    .map(item => cleanLine(item?.url))
    .filter(Boolean);

  if (attachments.length) {
    lines.push("", "Evidence:", ...attachments);
  }

  return {
    url: MODERATION_FORM_URL,
    subject,
    description: lines.join("\n"),
    attachments
  };
}

function attachmentsFromInteraction(interaction) {
  const src = interaction?.message ?? interaction;
  const files = src?.attachments ? Array.from(src.attachments.values()) : [];
  return files.map(att => ({ name: att.name, url: att.url }));
}

module.exports = {
  MODERATION_FORM_URL,
  buildModerationReport,
  attachmentsFromInteraction
};
