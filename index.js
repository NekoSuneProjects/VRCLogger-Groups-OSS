const {
  betterlog,
  express,
  cors,
} = require("./dependencies.js");

const config = require("./config/config.json");

// Extend getUser() with the authenticated Get Public Profile payload before
// vrchatnode.js creates any VRChat client instances.
require("./modules/vrchat-user-public-profile.js");

const {
  useVRChatAccountForRequest,
  getConfiguredVRChatPorts,
  getVRChatPortMappings,
} = require("./modules/vrchatnode.js");

const app = express();
app.use(cors());
app.use(useVRChatAccountForRequest);

// Groups Endpoints File
const VRCGroupsInviteEndpoint = require("./endpoints/Groups/VRCGroupInvites.js");
const VRCGroupsMessagesEndpoint = require("./endpoints/Groups/VRCGroupMessage.js");
const VRCGroupsModerationEndpoint = require("./endpoints/Groups/VRCGroupModerations.js");
const VRCGroupsRolesEndpoint = require("./endpoints/Groups/VRCGroupRoles.js");
const VRCGroupsSearchEndpoint = require("./endpoints/Groups/VRCGroupSearch.js");
const VRCGroupsGetEndpoint = require("./endpoints/Groups/VRCGroupGet.js");
const VRCGroupsMembershipEndpoint = require("./endpoints/Groups/VRCGroupMembership.js");
const VRCGroupJoinEndpoint = require("./endpoints/Groups/VRCGroupJoin.js");
const VRCGroupInvitesUserEndpoint = require("./endpoints/Groups/VRCGroupInvitesUser.js");
const VRCGroupPostsEndpoint = require("./endpoints/Groups/VRCGroupPosts.js");

// Users Endpoints File
const VRCUsersSearchEndpoint = require("./endpoints/Users/VRCGetUserSearch.js");
const VRCUsersFriendsEndpoint = require("./endpoints/Users/VRCUsersFriends.js");
const VRCUsersOnlineEndpoint = require("./endpoints/Users/VRCUsersOnline.js");

//World Endpoint File
const VRCWorldEndpoint = require("./endpoints/Worlds/VRCGetWorldSearch.js");

//Avatar Endpoint File
const VRCAvatarEndpoint = require("./endpoints/Avatars/AvatarsAPI.js");
const VRCCalendarEndpoint = require("./endpoints/Calendar/VRCCalendar.js");
const VRCPrintsEndpoint = require("./endpoints/Prints/VRCPrints.js");
const VRCInventoryEndpoint = require("./endpoints/Inventory/VRCInventory.js");

app.get("/", (req, res) => {
  res.json({ Status: "ONLINE!" });
});

// Groups Endpoints
app.use("/v1/vrchat/groups/messages", VRCGroupsMessagesEndpoint);
app.use("/v1/vrchat/groups/moderation", VRCGroupsModerationEndpoint);
app.use("/v1/vrchat/groups/invite", VRCGroupsInviteEndpoint);
app.use("/v1/vrchat/groups/role", VRCGroupsRolesEndpoint);
app.use("/v1/vrchat/groups/search", VRCGroupsSearchEndpoint);
app.use("/v1/vrchat/groups", VRCGroupsGetEndpoint);
app.use("/v1/vrchat/groups/membership", VRCGroupsMembershipEndpoint);
app.use("/v1/vrchat/groups/join", VRCGroupJoinEndpoint);
app.use("/v1/vrchat/groups/invites", VRCGroupInvitesUserEndpoint);
app.use("/v1/vrchat/groups/posts", VRCGroupPostsEndpoint);
// Users Endpoints
app.use("/v1/vrchat/users/search", VRCUsersSearchEndpoint);
app.use("/v1/vrchat/users/friends", VRCUsersFriendsEndpoint);
app.use("/v1/vrchat/users/online", VRCUsersOnlineEndpoint);

//World Endpoint
app.use("/v1/vrchat/world", VRCWorldEndpoint);

//Avatar Endpoint
app.use("/v1/vrchat/avatars", VRCAvatarEndpoint);
app.use("/v1/vrchat/calendar", VRCCalendarEndpoint);
app.use("/v1/vrchat/prints", VRCPrintsEndpoint);
app.use("/v1/vrchat/inventory", VRCInventoryEndpoint);

const configuredPorts = process.env.PORT
  ? [process.env.PORT]
  : getConfiguredVRChatPorts();
const listenPorts = [...new Set((configuredPorts.length > 0 ? configuredPorts : [config.PORT])
  .map(port => Number.parseInt(port, 10))
  .filter(port => Number.isInteger(port) && port > 0))];

if (listenPorts.length === 0) {
  throw new Error("No valid HTTP port configured.");
}

for (const port of listenPorts) {
  app.listen(port, () => {
    betterlog.ready(`Server is running on port ${port}`);
  });
}

for (const mapping of getVRChatPortMappings()) {
  betterlog.ready(`VRChat account ${mapping.account} mapped to port ${mapping.port}`);
}

betterlog.ready("Ready");

process.on("unhandledRejection", (reason, p) => {
  if (
    reason ===
    "Error [INTERACTION_ALREADY_REPLIED]: The reply to this interaction has already been sent or deferred."
  )
    return;

  betterlog.critical("Unhandled Rejection/Catch");
  betterlog.trace(reason?.stack || reason);
  betterlog.trace(p);
});
process.on("uncaughtException", (err, origin) => {
  betterlog.critical("Uncaught Exception/Catch");
  betterlog.trace(err?.stack || err);
  betterlog.trace(origin);
});

/*process.on("multipleResolves", (type, promise, reason) => {
  if (reason === "Error: Cannot perform IP discovery - socket closed") return;
  if (reason === "AbortError: The operation was aborted") return;

  betterlog.critical("Multiple Resolves");
  betterlog.trace(type);
  betterlog.trace(promise);
  betterlog.trace(reason?.stack || reason);
});*/
