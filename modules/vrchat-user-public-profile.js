const vrchat = require("vrchat");

// Patch the SDK once so the existing GetUsers() function receives the
// authenticated /profile/{userId} payload from the same VRChat client.
const PUBLIC_PROFILE_PATCH = Symbol.for("vrclogger.getUser.publicProfile");
const prototype = vrchat.VRChat?.prototype;

if (!prototype) {
  throw new Error("VRChat SDK does not expose VRChat.prototype.");
}

if (!prototype[PUBLIC_PROFILE_PATCH]) {
  const originalGetUser = prototype.getUser;

  if (typeof originalGetUser !== "function") {
    throw new Error("VRChat SDK does not expose getUser(). Update the vrchat npm package.");
  }

  prototype.getUser = async function getUserWithPublicProfile(options = {}) {
    const userId = options?.path?.userId;

    // Start both requests together to avoid adding a second round-trip to /userid.
    const userPromise = originalGetUser.call(this, options);
    const publicProfilePromise = userId && typeof this.getPublicProfile === "function"
      ? this.getPublicProfile({
          path: { userId },
          throwOnError: true
        })
          .then(response => ({ ok: true, response }))
          .catch(error => ({ ok: false, error }))
      : Promise.resolve({
          ok: false,
          error: new Error("VRChat SDK does not expose getPublicProfile().")
        });

    const userResponse = await userPromise;
    const publicProfileResult = await publicProfilePromise;

    if (!userResponse?.data || typeof userResponse.data !== "object") {
      return userResponse;
    }

    if (publicProfileResult.ok) {
      userResponse.data = {
        ...userResponse.data,
        publicProfile: publicProfileResult.response?.data ?? null
      };
      return userResponse;
    }

    const error = publicProfileResult.error;
    userResponse.data = {
      ...userResponse.data,
      publicProfile: null,
      publicProfileError: {
        status: error?.response?.status || 500,
        message:
          error?.response?.statusText ||
          error?.message ||
          "Failed to fetch VRChat public profile."
      }
    };

    return userResponse;
  };

  Object.defineProperty(prototype, PUBLIC_PROFILE_PATCH, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

module.exports = {
  patched: true
};
