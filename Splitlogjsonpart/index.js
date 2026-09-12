async function removetwobrackets(logParts) {
  // Split the log string to extract the JSON part
  const logParts444 = logParts.join(" ").split(" - "); // Splits at the last occurrence of " - "
  const jsonStringWithBrackets = logParts444[logParts444.length - 1].trim();

  // Join log parts back into a string
  let jsonObject = jsonStringWithBrackets;

  // Remove extra outer brackets
  if (jsonObject.startsWith("{{") && jsonObject.endsWith("}}")) {
    jsonObject = jsonObject.slice(1, -1);
  }
  return jsonObject;
}

module.exports = {
  removetwobrackets
};
