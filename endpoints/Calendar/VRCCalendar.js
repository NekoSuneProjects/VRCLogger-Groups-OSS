const { betterlog, express, bodyParser } = require("../../dependencies.js");

const router = express.Router();
const {
  GetCalendarEvents,
  GetFeaturedCalendarEvents,
  SearchCalendarEvents,
  GetGroupCalendarEvents,
  GetGroupCalendarEvent,
  GetGroupCalendarEventIcs,
  CreateGroupCalendarEvent,
  UpdateGroupCalendarEvent,
  DeleteGroupCalendarEvent
} = require("../../modules/vrchatnode.js");

betterlog.vrchatUser("VRChat Calendar System Active");

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

const parseDateParam = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

router.post("/events", async (req, res) => {
  const { date, n, offset } = req.body;
  const parsedDate = parseDateParam(date);
  if (parsedDate === null) {
    return res.status(400).json({
      status: 400,
      message: "Invalid date format."
    });
  }

  betterlog.vrchatUser("Calendar events requested");
  const result = await GetCalendarEvents({ date: parsedDate, n, offset });
  res.status(result.status || 200).json(result);
});

router.post("/events/featured", async (req, res) => {
  const { date, n, offset } = req.body;
  const parsedDate = parseDateParam(date);
  if (parsedDate === null) {
    return res.status(400).json({
      status: 400,
      message: "Invalid date format."
    });
  }

  betterlog.vrchatUser("Featured calendar events requested");
  const result = await GetFeaturedCalendarEvents({ date: parsedDate, n, offset });
  res.status(result.status || 200).json(result);
});

router.post("/events/search", async (req, res) => {
  const { searchTerm, utcOffset, n, offset, isInternalVariant } = req.body;
  if (!searchTerm) {
    return res.status(400).json({
      status: 400,
      message: "Missing searchTerm"
    });
  }

  betterlog.vrchatUser(`Calendar search requested (${searchTerm})`);
  const result = await SearchCalendarEvents({ searchTerm, utcOffset, n, offset, isInternalVariant });
  res.status(result.status || 200).json(result);
});

router.post("/groups/events", async (req, res) => {
  const { groupid, date, n, offset } = req.body;
  if (!groupid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid"
    });
  }

  const parsedDate = parseDateParam(date);
  if (parsedDate === null) {
    return res.status(400).json({
      status: 400,
      message: "Invalid date format."
    });
  }

  betterlog.vrchatGroup(`Group calendar events requested (${groupid})`);
  const result = await GetGroupCalendarEvents(groupid, { date: parsedDate, n, offset });
  res.status(result.status || 200).json(result);
});

router.post("/groups/event", async (req, res) => {
  const { groupid, calendarid } = req.body;
  if (!groupid || !calendarid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or calendarid"
    });
  }

  betterlog.vrchatGroup(`Group calendar event requested (${groupid}/${calendarid})`);
  const result = await GetGroupCalendarEvent(groupid, calendarid);
  res.status(result.status || 200).json(result);
});

router.get("/groups/event/ics/:groupid/:calendarid", async (req, res) => {
  const { groupid, calendarid } = req.params;
  betterlog.vrchatGroup(`Group calendar ICS requested (${groupid}/${calendarid})`);
  const result = await GetGroupCalendarEventIcs(groupid, calendarid);

  if (result.status && result.status !== 200) {
    return res.status(result.status).json(result);
  }

  res.header("Content-Type", "text/calendar; charset=utf-8");
  res.send(result.data || "");
});

router.post("/groups/event/create", async (req, res) => {
  const { groupid, event } = req.body;
  if (!groupid || !event) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or event"
    });
  }

  betterlog.vrchatGroup(`Create group calendar event requested (${groupid})`);
  const result = await CreateGroupCalendarEvent(groupid, event);
  res.status(result.status || 200).json(result);
});

router.post("/groups/event/update", async (req, res) => {
  const { groupid, calendarid, event } = req.body;
  if (!groupid || !calendarid || !event) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid, calendarid, or event"
    });
  }

  betterlog.vrchatGroup(`Update group calendar event requested (${groupid}/${calendarid})`);
  const result = await UpdateGroupCalendarEvent(groupid, calendarid, event);
  res.status(result.status || 200).json(result);
});

router.post("/groups/event/delete", async (req, res) => {
  const { groupid, calendarid } = req.body;
  if (!groupid || !calendarid) {
    return res.status(400).json({
      status: 400,
      message: "Missing groupid or calendarid"
    });
  }

  betterlog.vrchatGroup(`Delete group calendar event requested (${groupid}/${calendarid})`);
  const result = await DeleteGroupCalendarEvent(groupid, calendarid);
  res.status(result.status || 200).json(result);
});

module.exports = router;
