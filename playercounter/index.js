// Import dependencies
const { LOGSCLASS } = require("../Configfiles/logsclass.js");

// Initialize counters
let counters = {
  player: {
    size: 0,
    limit: 100 // Add a limit to the counter
  }
};

// Constants for statuses
const STATUS = {
  JOIN: "join",
  LEFT: "left",
  RESET: "reset"
};

// Utility function to validate counter type
const isValidCounterType = type => counters.hasOwnProperty(type);

// Utility function to validate status
const isValidStatus = status => Object.values(STATUS).includes(status);

// Function to dynamically add a counter
const addCounter = (type, limit = 100) => {
  if (counters[type]) {
    return handleError(`Counter type '${type}' already exists.`);
  }
  counters[type] = { size: 0, limit };
  return true;
};

// Function to dynamically remove a counter
const removeCounter = type => {
  if (!isValidCounterType(type)) {
    return handleError(`No counter found for type: ${type}`);
  }
  delete counters[type];
  return true;
};

// Function to update a counter
const updateCounter = (type, status) => {
  if (!isValidCounterType(type)) {
    return handleError(`No counter found for type: ${type}`);
  }

  if (!isValidStatus(status)) {
    return handleError(`Invalid status: ${status}`);
  }

  const counter = counters[type];

  switch (status) {
    case STATUS.JOIN:
      if (counter.size >= counter.limit) {
        return handleError(
          `Counter for type '${type}' has reached its limit of ${counter.limit}.`
        );
      }
      counter.size++;
      break;
    case STATUS.LEFT:
      // Ensure the counter does not go below 0
      if (counter.size > 0) {
        counter.size--;
      }
      break;
    case STATUS.RESET:
      counter.size = 0;
      break;
    default:
      return handleError(`Unhandled status: ${status}`);
  }

  logCounter(type, status);
  return true;
};

// Function to reset a counter
const resetCounter = type => {
  if (!isValidCounterType(type)) {
    return handleError(`No counter found for type: ${type}`);
  }

  counters[type].size = 0;
  logCounter(type, STATUS.RESET);
  return true;
};

// Function to set a new limit for a counter
const setLimit = (type, newLimit) => {
  if (!isValidCounterType(type)) {
    return handleError(`No counter found for type: ${type}`);
  }
  if (newLimit <= 0) {
    return handleError("Limit must be greater than zero.");
  }
  counters[type].limit = newLimit;
  return true;
};

// Function to log counter changes
const logCounter = async (type, status) => {
  return true;
};

// Utility function to handle errors
const handleError = errorMessage => {
  const timestamp = new Date().toISOString();
  const fullMessage = `[${timestamp}] ${errorMessage}`;
  console.error(fullMessage);
  LOGSCLASS.writeErrorToFile(fullMessage);
  return false;
};

module.exports = {
  resetCounter,
  updateCounter,
  addCounter,
  removeCounter,
  setLimit
};
