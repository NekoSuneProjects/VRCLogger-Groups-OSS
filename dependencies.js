const config = require("./config");
const betterlog = require("betterlog.js");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");
const chalk = require("chalk");
const bodyParser = require("body-parser");
const moment = require("moment");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  chalk,
  moment,
  sleep,
  bodyParser,
  betterlog,
  express,
  cors,
  path,
  fs,
  uuidv4,
  fetch
};
