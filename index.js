// ==UserScript==
// @name        Watches Favorites Viewer
// @namespace   Violentmonkey Scripts
// @match       *://*.furaffinity.net/*
// @require     https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js
// @grant       none
// @version     1.2
// @author      Midori Dragon
// @description Scans the Favorites of your Watches for new Favorites and shows a Button to view these (if any where found). (Works like Submission Page)
// @icon        https://www.furaffinity.net/themes/beta/img/banners/fa_logo.png?v2
// @homepageURL https://greasyfork.org/de/scripts/463464-watches-favorites-viewer-beta
// @supportURL  https://greasyfork.org/de/scripts/463464-watches-favorites-viewer-beta/feedback
// @license     MIT
// ==/UserScript==

// jshint esversion: 8

//User Options:
let showLoadLastXFavsButton = JSON.parse(localStorage.getItem("wfsetting_1"));
if (showLoadLastXFavsButton == null || showLoadLastXFavsButton == undefined)
  showLoadLastXFavsButton = true;
let maxFavsLength = +localStorage.getItem("wfsetting_2");
if (maxFavsLength == null || maxFavsLength == undefined || maxFavsLength == 0)
  maxFavsLength = 100;
let maxAmountRequests = +localStorage.getItem("wfsetting_3");
if (maxAmountRequests == null || maxAmountRequests == undefined || maxAmountRequests == 0)
  maxAmountRequests = 2;

if (window.parent !== window) return;
console.info("%cRunning: Watches Favorite Viewer", "color: blue");

let lastFavs = {};
let _running = false;
let exButtonsShown = false;
let firstStart = false;
let wfButton;
let settingsCount = 0;

let currentLength = 0;
let totalLength = 0;
let percent = 0;

let excludedUsers = JSON.parse(localStorage.getItem("excludedUsers")) || [];
let clicked = JSON.parse(localStorage.getItem("clicked")) || false;
let exSettings = JSON.parse(localStorage.getItem("wfsettings")) || false;

Object.defineProperty(window, "running", {
  get() {
    return _running;
  },
  set(value) {
    _running = value;
    wfButton.setAttribute("loading", value);
    if (running) {
      localStorage.setItem("wfloadingstate", "running");
    } else {
      localStorage.setItem("wfloadingstate", "finished");
      localStorage.removeItem("wfloadingusers");
      localStorage.removeItem("wfloadingpercent");
    }
  },
});

// Set state to interrupted if tab is closed while running
window.addEventListener("beforeunload", () => {
  if (running) localStorage.setItem("wfloadingstate", "interrupted");
});

if (window.location.toString().includes("buddylist")) {
  const controlPanel = document.getElementById("controlpanelnav");
  controlPanel.innerHTML += "<br><br>";
  const showExButton = document.createElement("button");
  showExButton.type = "button";
  showExButton.className = "button standard mobile-fix";
  showExButton.textContent = exButtonsShown ? "Hide WF Buttons" : "Show WF Buttons";
  showExButton.onclick = function () {
    exButtonsShown = !exButtonsShown;
    showExButton.textContent = exButtonsShown ? "Hide WF Buttons" : "Show WF Buttons";
    exButtonsShown ? addExcludeButtons() : removeExcludeButtons();
  };
  controlPanel.appendChild(showExButton);
}

if (!JSON.parse(localStorage.getItem("lastFavs"))) firstStart = true;

if (!clicked) createWFButton();

if (window.location.toString().includes("submissions") && clicked) {
  localStorage.setItem("clicked", false.toString());
  createWFDocument();
}

addExSettings();
if (window.location.toString().includes("controls/settings")) {
  addExSettingsSidebar();
  if (exSettings) createSettings();
}

// Add exclude buttons
async function addExcludeButtons() {
  // Wait for buddylist to load
  await waitForBuddyListOnePageReady();
  const watchers = document.querySelectorAll("div.flex-item-watchlist.aligncenter");

  for (const watcher of watchers) {
    const user = watcher.querySelector("a[href]");
    const username = user.href.substring(user.href.lastIndexOf("/") + 1, user.href.length - 1);

    const excludeButton = document.createElement("button");
    excludeButton.id = "excludeButton_" + username;
    excludeButton.type = "button";
    excludeButton.className = "button standard mobile-fix";
    excludeButton.textContent = excludedUsers.includes(username) ? "^ WF Include ^" : "^ WF Exclude ^";
    excludeButton.addEventListener("click", () => toggleExcludeUser(user, excludeButton));

    watcher.style.paddingBottom = "18px";
    watcher.appendChild(excludeButton);
  }
}

// Remove exclude buttons
async function removeExcludeButtons() {
  let buttons = document.querySelectorAll("button[id^=excludeButton]");
  for (const button of buttons) {
    button.parentNode.style.paddingBottom = "";
    button.parentNode.removeChild(button);
  }
}

// Toggle exclude user
async function toggleExcludeUser(user, button) {
  const username = user.href.substring(user.href.lastIndexOf("/") + 1, user.href.length - 1);

  if (excludedUsers.includes(username)) {
    // Remove user from excludedUsers
    excludedUsers = excludedUsers.filter((name) => name !== username);
    if (button) button.textContent = "^ WF Exclude ^";
    console.log('Including: "' + username + '"');
  } else {
    // Add user to excludedUsers
    excludedUsers.push(username);
    if (button) button.textContent = "^ WF Include ^";
    console.log('Excluding: "' + username + '"');
  }

  localStorage.setItem("excludedUsers", JSON.stringify(excludedUsers));
}

// Creating the WFButton and loading the favs
async function createWFButton() {
  // Create WFButton
  wfButton = document.createElement("a");
  wfButton.id = "wfButton";
  wfButton.className = "notification-container inline";
  wfButton.title = "Watches Favorites Notifications";
  wfButton.style.cursor = "pointer";
  const messageBar = document.getElementsByClassName("message-bar-desktop")[0];
  messageBar.appendChild(wfButton);

  lastFavs = JSON.parse(localStorage.getItem("lastFavs"));

  // Check loadingstate and wait for other instance to finish
  let newFavs;
  let finished = false;
  let intSavedUsers;
  const state = localStorage.getItem("wfloadingstate");
  if (state && state !== "finished") {
    console.log("Other WF instance found copying...");
    let status = await waitForOtherInstance();
    finished = status.successfull;
    intSavedUsers = status.intSavedUsers || [];
  }

  running = true;

  if (finished) {
    // Load finished favs
    newFavs = JSON.parse(await decompressString(localStorage.getItem("wfloading")));
  } else {
    // Load new favs
    newFavs = await loadUnreadFavsAll(maxFavsLength, intSavedUsers);
    newFavs = Array.from(newFavs);
    newFavs = newFavs.map((newFav) => newFav.outerHTML);
  }

  // Update WFButton
  const totalLength = newFavs.length;
  if (totalLength !== 0) {
    wfButton.addEventListener("click", loadWFDocument);
    wfButton.textContent = `${totalLength}WF`;
  } else if (firstStart) {
    // Replace WFButton with Ready Text
    wfButton.textContent = "WF Ready";
    wfButtonClone = wfButton.cloneNode(true);
    wfButtonClone.setAttribute("loading", false);
    wfButtonClone.addEventListener("click", () => { location.reload(); });
    wfButton.parentNode.replaceChild(wfButtonClone, wfButton);
  } else {
    wfButton.parentNode.removeChild(wfButton);
  }

  // Compress and save new favs
  const favsComp = await compressString(JSON.stringify(newFavs));
  localStorage.setItem("favs", favsComp);

  console.log("Finished scanning");
  console.log(`There are "${totalLength}" unseen Favs`);
  running = false;

  // Show last XFavs button if there are no new favs
  if (totalLength === 0 && !firstStart && showLoadLastXFavsButton) {
    createLastXFavsButton();
  }

  firstStart = false;
}

// Waiting for other WF instance
async function waitForOtherInstance() {
  return new Promise((resolve, reject) => {
    // Get current loadingstate
    let state = localStorage.getItem("wfloadingstate");
    if (state === null) {
      resolve({ successfull: false });
      return;
    }
    let lpercent = 0;
    let intSavedUsers = [];

    // Check loadingstate
    const intervalId = setInterval(() => {
      state = localStorage.getItem("wfloadingstate");
      if (state === "finished") {
        clearInterval(intervalId);
        resolve({ successfull: true });
      } else if (state === "interrupted") {
        clearInterval(intervalId);
        intSavedUsers = JSON.parse(localStorage.getItem("wfloadingusers")) || [];
        resolve({ successfull: false, intSavedUsers: intSavedUsers });
      } else {
        percent = localStorage.getItem("wfloadingpercent");
        if (percent !== lpercent) {
          lpercent = percent;
          console.log(`Copying: ${percent}%`);
          wfButton.textContent = `WF: ${percent}%`;
        }
      }
    }, 100);
  });
}

// Loads the WFDocument
async function loadWFDocument() {
  localStorage.setItem("lastFavs", JSON.stringify(lastFavs));
  localStorage.setItem("clicked", true.toString());

  window.location.href = "https://www.furaffinity.net/msg/submissions/";
}

// Creating the WFDocument to view the favs
async function createWFDocument() {
  const standardPage = document.getElementById("standardpage");
  const messageCenter = document.getElementById("messagecenter-submissions");

  const emptyElem = messageCenter.querySelector('div[class="no-messages"]');
  if (emptyElem) emptyElem.remove();

  const header = standardPage.querySelector('div[class="section-header"] h2');
  header.textContent = "Watches Favorites";

  const oldNewButtonsButtonsTop = standardPage.querySelector('div[class="aligncenter"][style]');
  oldNewButtonsButtonsTop.remove();

  const selectionButtons = standardPage.querySelector('button[class="standard check-uncheck"]').parentNode.parentNode.parentNode;
  selectionButtons.remove();

  const oldNewButtonsBottom = messageCenter.parentNode.querySelector('div[class="aligncenter"]');
  oldNewButtonsBottom.remove();

  const galleries = document.querySelectorAll('div[class="notifications-by-date"]');
  galleries.forEach((gallery) => gallery.remove());

  let gallery = document.getElementById("gallery-0");
  if (!gallery) {
    gallery = document.createElement("section");
    gallery.id = "gallery-0";
    gallery.className = "gallery messagecenter with-checkboxes s-250";
    messageCenter.appendChild(gallery);
  }
  gallery.innerHTML = "";

  const favsDecomp = await decompressString(localStorage.getItem("favs"));
  const figures = JSON.parse(favsDecomp);
  const parser = new DOMParser();
  const figureElements = figures.map((figure) => parser.parseFromString(figure, "text/html").body.firstChild);
  console.log(`Loading "${figureElements.length}" figures`);

  figureElements.forEach((figure) => gallery.appendChild(figure));
}

// Loading all unseen favs
async function loadUnreadFavsAll(maxFavsLength, intSavedUsers = []) {
  // Getting watchers
  const watchers = await getWatchers();
  totalLength = watchers.length;
  console.log(`You are watching "${totalLength}" people`);
  console.log("Scanning for unseen Favs...");

  // Getting lastFavs
  let progress = { newFavs: [], percent: 0, intSavedUsers: intSavedUsers, currScanFavs: [] };
  let newFavsAll = [];
  let promises = [];
  let semaphore = new Semaphore(maxAmountRequests);
  for (const watcher of watchers) {
    promises.push(
      semaphore.acquire().then(async () => {
        try {
          const watcherLink = watcher.querySelector("a").href;
          if (!intSavedUsers.includes(watcherLink)) {
            // Getting newFavs from watcher
            progress = await getUnreadFavsWatcher(watcherLink, maxFavsLength, progress);
            if (progress.newFavs) {
              newFavsAll = newFavsAll.concat(progress.newFavs);
            }

            // Updating WF Button prefix
            if (firstStart) {
              wfButton.textContent = `WF Initializing: ${percent.toFixed(2)}%`;
            } else {
              wfButton.textContent = `WF: ${percent.toFixed(2)}%`;
            }
          }
        } catch (error) {
          console.error(error);
        }
        finally {
          semaphore.release();
        }
      })
    );
  }
  await Promise.all(promises);

  // Updating firstStart
  if (firstStart) {
    localStorage.setItem("lastFavs", JSON.stringify(lastFavs));
    newFavsAll = [];
  }
  totalLength = 0;

  return newFavsAll;
}

async function getWatchers() {
  let watchers = [];
  let prevWatchers;
  for (let i = 1; true; i++) {
    // Getting watchers html from page i
    const watchersDoc = await getHTML(`https://www.furaffinity.net/controls/buddylist/${i}/`);
    const nextWatchers = Array.from(watchersDoc.querySelectorAll('div[class="flex-item-watchlist aligncenter"]'));
    if (prevWatchers && prevWatchers[prevWatchers.length - 1].outerHTML == nextWatchers[nextWatchers.length - 1].outerHTML) break;
    prevWatchers = nextWatchers;
    watchers.push(...nextWatchers);
  }
  return watchers;
}

// Getting newFavs from a specific watcher
async function getUnreadFavsWatcher(watcher, maxFavsLength, progress, ignoreLastSeen = false) {
  // Getting username from watcher
  let user = watcher.substring(0, watcher.length - 1);
  user = user.substring(user.lastIndexOf("/"), user.length);
  user = user.substring(1, user.length);

  // Calculating current percent
  percent = (currentLength / totalLength) * 100;
  currentLength++;

  // Checking if user is excluded
  if (excludedUsers.includes(user)) {
    console.log(`${percent.toFixed(2)}% | ${user} is excluded`);
    return { intSavedUsers: progress.intSavedUsers, currScanFavs: progress.currScanFavs };
  } else {
    console.log(`${percent.toFixed(2)}% | ${user}`);
  }

  // Getting fav figures from user
  const figuresAll = await getUserFavFigures(user, maxFavsLength, ignoreLastSeen);

  // Exclude user if no images found
  if (figuresAll && figuresAll === "no-images") {
    console.log(user + " gets excluded");
    let excludeButton = document.getElementById("excludeButton_" + user);
    //excludeUser(watcher, excludeButton);
    return { intSavedUsers: progress.intSavedUsers, currScanFavs: progress.currScanFavs };
  }

  // Changing Caption to include user
  let newFavs = [];
  for (const figure of figuresAll) {
    const figcaption = figure.querySelector("figcaption");
    const byElem = figcaption.childNodes[1].cloneNode(true);
    const linkElem = byElem.querySelector("a[href]");
    const iElem = byElem.querySelector("i");
    const aElem = byElem.querySelector("a");

    linkElem.style.fontWeight = "400";
    iElem.textContent = "from";
    aElem.title = user;
    aElem.textContent = user;
    aElem.href = `https://www.furaffinity.net/favorites/${user}`;

    figcaption.appendChild(byElem);
    newFavs.push(figure);
  }

  // Removing lastFavs from figures
  let newCurrScanFavs = newFavs.map((figure) => figure.outerHTML);
  progress.currScanFavs = progress.currScanFavs.concat(newCurrScanFavs);

  // Saving progress to localStorage
  progress.intSavedUsers.push(watcher);
  localStorage.setItem("wfloadingusers", JSON.stringify(progress.intSavedUsers));
  localStorage.setItem("wfloadingpercent", percent.toFixed(2));
  setCompLocalStorageArrayItemAsync("wfloading", progress.currScanFavs);

  return { newFavs: newFavs, intSavedUsers: progress.intSavedUsers, currScanFavs: progress.currScanFavs };
}

async function createLastXFavsButton() {
  let lastXFavsButton = document.createElement("a");
  lastXFavsButton.id = "lastXFavsButton";
  lastXFavsButton.className = "notification-container inline";
  lastXFavsButton.textContent = "Load last x Favs";
  lastXFavsButton.title = "Show last X Favorites";
  lastXFavsButton.style.cursor = "pointer";
  lastXFavsButton.addEventListener("click", () => {
    currentLength = 0;
    let amount = prompt("Enter the amount of Favs you want to load: ");
    while (amount && isNaN(parseInt(amount))) amount = prompt("Input was not a Number. Please enter the amount of Favs you want to load: ");
    if (amount && amount > 0) loadLastXFavsAll(lastXFavsButton, amount);
  });
  document.getElementsByClassName("message-bar-desktop")[0].appendChild(lastXFavsButton);
}

async function loadLastXFavsAll(lastXFavsButton, amount) {
  // Getting watchers
  const watchers = await getWatchers();
  totalLength = watchers.length;
  console.log(`You are watching "${totalLength}" people`);
  console.log(`Searching for last "${amount}" Favs...`);

  // Getting lastFavs
  let progress = { newFavs: [], percent: 0, intSavedUsers: [], currScanFavs: [] };
  let newFavsAll = [];
  let promises = [];
  let semaphore = new Semaphore(2);
  for (const watcher of watchers) {
    promises.push(
      semaphore.acquire().then(async () => {
        try {
          const watcherLink = watcher.querySelector("a").href;
          // Getting last favs from watcher
          progress = await getUnreadFavsWatcher(watcherLink, amount, progress, true);
          if (progress.newFavs) {
            newFavsAll = newFavsAll.concat(progress.newFavs);
          }

          // Updating LastXButton prefix
          lastXFavsButton.textContent = `WF Last ${amount}: ${percent.toFixed(2)}%`;
        } catch (error) {
          console.error(error);
        }
        finally {
          semaphore.release();
        }
      })
    );
  }
  await Promise.all(promises);

  // Loading last x favs
  const figureCount = newFavsAll.length;
  if (figureCount !== 0) {
    lastXFavsButton.setAttribute("loading", false);
    lastXFavsButton.textContent = figureCount + "WF";
    totalLength = 0;
    localStorage.setItem("clicked", true);
    newFavsAll = Array.from(newFavsAll);
    newFavsAll = newFavsAll.map((newFav) => newFav.outerHTML);
    var favsComp = await compressString(JSON.stringify(newFavsAll));
    localStorage.setItem("favs", favsComp);
    window.location.href = "https://www.furaffinity.net/msg/submissions/";
  } else lastXFavsButton.parentNode.removeChild(lastXFavsButton);

  totalLength = 0;

  return newFavsAll;
}

// Getting fav figures from a specific user
async function getUserFavFigures(user, maxFavsLength, ignoreLastSeen = false) {
  // Checking last seen fav
  const lastFavsTemp = JSON.parse(localStorage.getItem("lastFavs")) || {};
  const userInLastFavs = user in lastFavsTemp;

  let figuresAll = [];
  let lastFigureIndex = -1;
  for (let i = 1; lastFigureIndex == -1 && (i == 0 || figuresAll.length < maxFavsLength); i++) {
    // Getting figures html from page i
    const favLink = `https://www.furaffinity.net/favorites/${user}/${i}`;
    const favs = await getHTML(favLink);
    if (!favs || !favs.body) break;
    if (favs.getElementById("no-images")) {
      return "no-images";
    }
    const figures = Array.from(favs.body.getElementsByTagName("figure"));
    if (!figures || figures.length == 0) break;

    // Check last seen fav
    if (!ignoreLastSeen && userInLastFavs) {
      lastFigureIndex = figuresAll.findIndex((figure) => figure.id == lastFavsTemp[user]); //figures
    }
    figuresAll = figuresAll.concat(figures);
    if (!userInLastFavs)
      break;
  }

  if (figuresAll.length > maxFavsLength) {
    figuresAll = figuresAll.slice(0, maxFavsLength);
  }

  if (!ignoreLastSeen && lastFigureIndex !== -1) {
    figuresAll = figuresAll.slice(0, lastFigureIndex);
    if (figuresAll.length !== 0) lastFavs[user] = figuresAll[0].id;
  } else if (firstStart) {
    if (figuresAll && figuresAll.length !== 0) {
      if (!lastFavs) lastFavs = {};
      lastFavs[user] = figuresAll[0].id;
    }
  } else if (!userInLastFavs) {
    lastFavs[user] = figuresAll[0].id;
  }

  return figuresAll;
}

async function getHTML(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc;
  } catch (error) {
    console.error(error);
  }
}

async function setCompLocalStorageArrayItemAsync(itemname, item) {
  let itemcomp = await compressString(JSON.stringify(item));
  localStorage.setItem(itemname, itemcomp);
}

async function compressString(str) {
  return LZString.compress(str);
}

async function decompressString(compStr) {
  return LZString.decompress(compStr);
}

class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = 0;
    this.waitingQueue = [];
  }

  acquire() {
    return new Promise((resolve, reject) => {
      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  release() {
    if (this.waitingQueue.length > 0) {
      let nextResolve = this.waitingQueue.shift();
      nextResolve();
    } else {
      this.currentConcurrency--;
    }
  }
}

// ------------------------------ //
// ---------- SETTINGS ---------- //
// ------------------------------ //

// Adding settings to the navigation menu
async function addExSettings() {
  const settings = document.querySelector('ul[class="navhideonmobile"]').querySelector('a[href="/controls/settings/"]').parentNode;

  if (document.getElementById("extension_settings")) {
    document.getElementById("midori_settings").addEventListener("click", function () {
      localStorage.setItem("wfsettings", true.toString());
    });
    return;
  }
  let exSettingsHeader = document.createElement("h3");
  exSettingsHeader.id = "extension_settings";
  exSettingsHeader.textContent = "Extension Settings";
  settings.appendChild(exSettingsHeader);

  let wfsettings = document.createElement("a");
  wfsettings.id = "midori_settings";
  wfsettings.textContent = "Midori's Script Settings";
  wfsettings.style.cursor = "pointer";
  wfsettings.onclick = function () {
    localStorage.setItem("wfsettings", true.toString());
    window.location = "https://www.furaffinity.net/controls/settings";
  };
  settings.appendChild(wfsettings);
}

// Adding settings to the settings sidebar menu
async function addExSettingsSidebar() {
  const settings = document.getElementById("controlpanelnav");

  if (document.getElementById("extension_settings_side")) {
    document.getElementById("midori_settings_side").addEventListener("click", function () {
      localStorage.setItem("wfsettings", true.toString());
    });
    return;
  }
  let exSettingsHeader = document.createElement("h3");
  exSettingsHeader.id = "extension_settings_side";
  exSettingsHeader.textContent = "Extension Settings";
  settings.appendChild(exSettingsHeader);

  let wfsettings = document.createElement("a");
  wfsettings.id = "midori_settings_side";
  wfsettings.textContent = "Midori's Script Settings";
  wfsettings.style.cursor = "pointer";
  wfsettings.onclick = function () {
    localStorage.setItem("wfsettings", true.toString());
    window.location = "https://www.furaffinity.net/controls/settings";
  };
  settings.appendChild(wfsettings);
}

// Creating the settings page
async function createSettings() {
  localStorage.setItem("wfsettings", false.toString());
  const columnPage = document.getElementById("columnpage");
  const content = columnPage.querySelector('div[class="content"]');
  for (const section of content.querySelectorAll('section:not([class="exsettings"])')) section.parentNode.removeChild(section);

  const section = document.createElement("section");
  section.className = "exsettings";
  const headerContainer = document.createElement("div");
  headerContainer.className = "section-header";
  const header = document.createElement("h2");
  header.textContent = "Watches Favorite Viewer Settings";
  headerContainer.appendChild(header);
  section.appendChild(headerContainer);
  const bodyContainer = document.createElement("div");
  bodyContainer.className = "section-body";

  // Last X Favs Setting
  const lastXFavsSetting = createSetting("Last X Favs", "Sets wether the Load last x Favs buttons appears after a new Fav scan found no new Favs", "boolean", "Show Last X Favs Button", (target) => {
    showLoadLastXFavsButton = target.checked;
    localStorage.setItem(target.id, showLoadLastXFavsButton.toString());
  });
  lastXFavsSetting.querySelector('[id*="setting"]').checked = showLoadLastXFavsButton;
  bodyContainer.appendChild(lastXFavsSetting);

  // Max Favs Loaded Setting
  const maxFavsLoadedSetting = createSetting("Max Favs Loaded", "Sets the maximum number of Favs loaded", "number", "", (target) => {
    maxFavsLength = +target.value;
    localStorage.setItem(target.id, maxFavsLength.toString());
  });
  maxFavsLoadedSetting.querySelector('[id*="setting"]').value = maxFavsLength.toString();
  bodyContainer.appendChild(maxFavsLoadedSetting);

  // Max amount of simultaneous requests Setting
  const maxAmountSimultaneousRequestsSetting = createSetting("Max amount of simultaneous requests", "Sets the maximum number of simultaneous requests. Higher value means faster scans but a too high value will overload Furaffinity and crash the Extension", "number", "", (target) => {
    maxAmountRequests = +target.value;
    localStorage.setItem(target.id, maxAmountRequests.toString());
  });
  maxAmountSimultaneousRequestsSetting.querySelector('[id*="setting"]').value = maxAmountRequests.toString();
  bodyContainer.appendChild(maxAmountSimultaneousRequestsSetting);

  // Reset Synchronisation Error Setting
  const resetSynchronizationErrorSetting = createSetting("Reset Synchronisation", "Resets the synchronisation variable to fix an error that no scan will start", "action", "Reset Loadingstate", (target) => {
    localStorage.removeItem("wfloadingstate");
    const wfloadingstatetemp = localStorage.getItem("wfloadingstate");
    if (wfloadingstatetemp == null || wfloadingstatetemp == undefined) {
      target.textContent = "<---- Success ---->";
      setTimeout(() => {
        target.textContent = "Reset Loadingstate";
      }, 3000);
    } else {
      target.textContent = "<---- Failed ---->";
      setTimeout(() => {
        target.textContent = "Reset Loadingstate";
      }, 3000);
    }
  });
  bodyContainer.appendChild(resetSynchronizationErrorSetting);

  // Reset Saving Variable Setting
  const resetSavingVariableSetting = createSetting("Reset Last seen Favs", "Resets the last seen favs variable to reinitialize the Fav-Scanner", "action", "Reset Last seen Favs", (target) => {
    localStorage.removeItem("lastFavs");
    const lastfavxtemp = localStorage.getItem("lastFavs");
    if (lastfavxtemp == null || lastfavxtemp == undefined) {
      target.textContent = "<---- Success ---->";
      setTimeout(() => {
        target.textContent = "Reset Last seen Favs";
      }, 3000);
    } else {
      target.textContent = "<---- Failed ---->";
      setTimeout(() => {
        target.textContent = "Reset Last seen Favs";
      }, 3000);
    }
  });
  bodyContainer.appendChild(resetSavingVariableSetting);

  section.appendChild(bodyContainer);
  content.appendChild(section);
}

function createSetting(name, description, type, typeDescription, executeFunction) {
  const settingContainer = document.createElement("div");
  settingContainer.className = "control-panel-item-container";

  const settingName = document.createElement("div");
  settingName.className = "control-panel-item-name";
  const settingNameText = document.createElement("h4");
  settingNameText.textContent = name;
  settingName.appendChild(settingNameText);
  settingContainer.appendChild(settingName);

  const settingDesc = document.createElement("div");
  settingDesc.className = "control-panel-item-description";
  const settingDescText = document.createTextNode(description);
  settingDesc.appendChild(settingDescText);
  settingContainer.appendChild(settingDesc);

  const settingOption = document.createElement("div");
  settingOption.className = "control-panel-item-options";

  if (type === "number") {
    settingsCount++;
    const settingInput = document.createElement("input");
    settingInput.id = "wfsetting_" + settingsCount;
    settingInput.type = "text";
    settingInput.className = "textbox";
    settingInput.addEventListener("keydown", (event) => {
      const currentValue = parseInt(settingInput.value) || 0;
      if (event.key === "ArrowUp") {
        settingInput.value = (currentValue + 1).toString();
        executeFunction(settingInput);
      } else if (event.key === "ArrowDown") {
        if (currentValue != 0)
          settingInput.value = (currentValue - 1).toString();
        executeFunction(settingInput);
      }
    });
    settingInput.addEventListener("input", () => {
      settingInput.value = settingInput.value.replace(/[^0-9]/g, "");
      if (settingInput.value < 0)
        settingInput.value = 0;
    });
    settingInput.addEventListener("input", () => executeFunction(settingInput));
    settingOption.appendChild(settingInput);
  } else if (type === "boolean") {
    settingsCount++;
    const settingCheckbox = document.createElement("input");
    settingCheckbox.id = "wfsetting_" + settingsCount;
    settingCheckbox.type = "checkbox";
    settingCheckbox.style.cursor = "pointer";
    settingCheckbox.style.marginRight = "4px";
    settingCheckbox.addEventListener("change", () => executeFunction(settingCheckbox));
    settingOption.appendChild(settingCheckbox);
    const settingOptionLabel = document.createElement("label");
    settingOptionLabel.textContent = typeDescription;
    settingOptionLabel.style.cursor = "pointer";
    settingOptionLabel.addEventListener("click", () => {
      settingCheckbox.checked = !settingCheckbox.checked;
      executeFunction(settingCheckbox);
    });
    settingOption.appendChild(settingOptionLabel);
  } else if (type === "action") {
    settingsCount++;
    const settingButton = document.createElement("button");
    settingButton.id = "wfsetting_" + settingsCount;
    settingButton.type = "button";
    settingButton.className = "button standard mobile-fix";
    settingButton.textContent = typeDescription;
    settingButton.addEventListener("click", () => executeFunction(settingButton));
    settingOption.appendChild(settingButton);
  }

  settingContainer.appendChild(settingOption);

  return settingContainer;
}
