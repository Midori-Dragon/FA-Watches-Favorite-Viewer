// ==UserScript==
// @name        Watches Favorites Viewer (Beta)
// @namespace   Violentmonkey Scripts
// @match       *://*.furaffinity.net/*
// @require     https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js
// @grant       none
// @version     0.8
// @author      Midori Dragon
// @description Scans the Favorites of your Watches for new Favorites and shows a Button to view these (if any where found). (Works like Submission Page)
// @icon        https://www.furaffinity.net/themes/beta/img/banners/fa_logo.png?v2
// @homepageURL https://greasyfork.org/de/scripts/463464-watches-favorites-viewer-beta
// @supportURL  https://greasyfork.org/de/scripts/463464-watches-favorites-viewer-beta/feedback
// @license     MIT
// ==/UserScript==

// jshint esversion: 8

//User Options:
let showLoadLastXFavsButton = JSON.parse(localStorage.getItem("wfsetting_01"));
if (showLoadLastXFavsButton == null) showLoadLastXFavsButton = true;
let maxFavsLength = +localStorage.getItem("wfsetting_02");
if (maxFavsLength == null || maxFavsLength == 0) maxFavsLength = 100;

if (window.parent !== window) return;
console.info("%cRunning: Watches Favorite Viewer", "color: blue");

let excludedUsers = JSON.parse(localStorage.getItem("excludedUsers"));
if (!excludedUsers) excludedUsers = [];
let lastFavs = {};
let currScanFavs = [];
let intSavedUsers = [];
let running = false;
let percent = 0;
let totalLength = 0;
let currentLength = 0;
let figureCount = 0;
let exButtonsShown = false;
let firstStart = false;
let clicked = JSON.parse(localStorage.getItem("clicked"));
if (clicked == null) clicked = false;
let exSettings = JSON.parse(localStorage.getItem("wfsettings"));
if (exSettings == null) exSettings = false;

addWFSettings();

window.addEventListener("beforeunload", function (event) {
  if (running) localStorage.setItem("wfloadingstate", "interrupted");
});

if (window.location.toString().includes("buddylist")) {
  let controlPanel = document.getElementById("controlpanelnav");
  controlPanel.appendChild(document.createElement("br"));
  controlPanel.appendChild(document.createElement("br"));
  let showExButton = document.createElement("button");
  showExButton.type = "button";
  showExButton.className = "button standard mobile-fix";
  showExButton.textContent = "Show WF Buttons";
  showExButton.onclick = function () {
    if (!exButtonsShown) {
      showExButton.textContent = "Hide WF Buttons";
      createExcludeButtons();
    } else {
      showExButton.textContent = "Show WF Buttons";
      removeExcludeButtons();
    }
    exButtonsShown = !exButtonsShown;
  };
  controlPanel.appendChild(showExButton);
}

if (!JSON.parse(localStorage.getItem("lastFavs"))) firstStart = true;

if (!clicked) createWFButton();

if (window.location.toString().includes("submissions") && clicked) {
  localStorage.setItem("clicked", false.toString());
  createWFDocument();
}

if (window.location.toString().includes("controls/settings")) {
  addWFSettingsSidebar();
  if (exSettings) createSettings();
}

function waitForBuddyListOnePageReady() {
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      const buddyListOnePageReady = localStorage.getItem("buddyListOnePageReady") == "true";
      if (buddyListOnePageReady) {
        clearInterval(intervalId);
        resolve();
      }
    }, 100);
  });
}

async function createExcludeButtons() {
  await waitForBuddyListOnePageReady();
  for (const watcher of document.querySelectorAll('div[class="flex-item-watchlist aligncenter"]')) {
    let user = watcher.querySelector("a[href]");
    let username = user.href.substring(0, user.href.length - 1);
    username = username.substring(username.lastIndexOf("/") + 1, username.length);

    let excludeButton = document.createElement("button");
    excludeButton.id = "excludeButton_" + username;
    excludeButton.type = "button";
    excludeButton.className = "button standard mobile-fix";
    if (excludedUsers.includes(username)) excludeButton.textContent = "^ WF Include ^";
    else excludeButton.textContent = "^ WF Exclude ^";
    excludeButton.onclick = function () {
      if (excludedUsers.includes(username)) includeUser(user.href, excludeButton);
      else excludeUser(user.href, excludeButton);
    };
    watcher.style.paddingBottom = "18px";
    watcher.appendChild(excludeButton);
  }
}

async function removeExcludeButtons() {
  let buttons = document.querySelectorAll("button[id^=excludeButton]");
  for (const button of buttons) {
    button.parentNode.style.paddingBottom = "";
    button.parentNode.removeChild(button);
  }
}

async function excludeUser(user, button) {
  let username = user.substring(0, user.length - 1);
  username = username.substring(username.lastIndexOf("/") + 1, username.length);

  if (excludedUsers.includes(username)) return;

  excludedUsers.push(username);
  localStorage.setItem("excludedUsers", JSON.stringify(excludedUsers));
  if (button) button.textContent = "^ WF Include ^";
  console.log('Excluding: "' + username + '"');
}

async function includeUser(user, button) {
  let username = user.substring(0, user.length - 1);
  username = username.substring(username.lastIndexOf("/") + 1, username.length);

  const index = excludedUsers.indexOf(username);
  if (index == -1) return;

  excludedUsers.splice(index, 1);
  localStorage.setItem("excludedUsers", JSON.stringify(excludedUsers));
  if (button) button.textContent = "^ WF Exclude ^";
  console.log('Including: "' + username + '"');
}

async function createWFButton() {
  let wfButton = document.createElement("a");
  wfButton.id = "wfButton";
  wfButton.className = "notification-container inline";
  wfButton.title = "Watches Favorites Notifications";
  wfButton.style.cursor = "pointer";
  document.getElementsByClassName("message-bar-desktop")[0].appendChild(wfButton);

  lastFavs = JSON.parse(localStorage.getItem("lastFavs"));
  if (!lastFavs) lastFavs = {};

  let newFavs;
  let finished = false;
  let state = localStorage.getItem("wfloadingstate");
  if (state && state != "finished") {
    console.log("Other WF instance found copying...");
    finished = await waitForOtherInstance(wfButton);
  }

  wfButton.setAttribute("loading", true);
  running = true;
  localStorage.setItem("wfloadingstate", "running");

  if (finished) {
    newFavs = await decompressString(localStorage.getItem("wfloading"));
    newFavs = JSON.parse(newFavs);
    if (newFavs.length != 0) {
      wfButton.setAttribute("loading", false);
      wfButton.textContent = newFavs.length + "WF";
      wfButton.onclick = start;
    } else wfButton.parentNode.removeChild(wfButton);
  } else {
    newFavs = await getUnreadFavsLengthAll(wfButton);
    newFavs = Array.from(newFavs);
    newFavs = newFavs.map((newFav) => newFav.outerHTML);
  }

  let favsComp = await compressString(JSON.stringify(newFavs));
  localStorage.setItem("favs", favsComp);
  totalLength = newFavs.length;

  console.log("Finished scanning");
  console.log('There are "' + totalLength + '" unseen Favs');
  running = false;
  localStorage.setItem("wfloadingstate", "finished");
  localStorage.removeItem("wfloadingusers");
  localStorage.removeItem("wfloadingpercent");

  if (totalLength == 0 && showLoadLastXFavsButton) createLastXFavsButton();
}

async function waitForOtherInstance(wfButton) {
  return new Promise((resolve, reject) => {
    let state = localStorage.getItem("wfloadingstate");
    if (state == null) {
      resolve(false);
      return;
    }
    let lpercent = 0;
    const intervalId = setInterval(() => {
      state = localStorage.getItem("wfloadingstate");
      if (state == "finished") {
        clearInterval(intervalId);
        resolve(true);
      } else if (state == "interrupted") {
        clearInterval(intervalId);
        resolve(false);
        intSavedUsers = JSON.parse(localStorage.getItem("wfloadingusers"));
        if (intSavedUsers == null) intSavedUsers = [];
      } else {
        let percent = localStorage.getItem("wfloadingpercent");
        if (percent != lpercent) {
          lpercent = percent;
          console.log("Copying: " + percent + "%");
          wfButton.textContent = "WF: " + percent + "%";
        }
      }
    }, 100);
  });
}

async function start() {
  localStorage.setItem("lastFavs", JSON.stringify(lastFavs));
  localStorage.setItem("clicked", true.toString());

  window.location.href = "https://www.furaffinity.net/msg/submissions/";
}

async function createWFDocument() {
  const standardPage = document.getElementById("standardpage");
  const messageCenter = document.getElementById("messagecenter-submissions");
  const emptyElem = messageCenter.querySelector('div[class="no-messages"]');

  if (emptyElem) messageCenter.removeChild(emptyElem);

  let header = standardPage.querySelector('div[class="section-header"]').querySelector("h2");
  header.textContent = "Watches Favorites";

  let oldNewButtonsButtonsTop = standardPage.querySelector('div[class="aligncenter"][style]');
  oldNewButtonsButtonsTop.parentNode.removeChild(oldNewButtonsButtonsTop);

  let selectionButtons = standardPage.querySelector('button[class="standard check-uncheck"]').parentNode.parentNode.parentNode;
  selectionButtons.parentNode.removeChild(selectionButtons);

  let oldNewButtonsBottom = messageCenter.parentNode.querySelector('div[class="aligncenter"]');
  oldNewButtonsBottom.parentNode.removeChild(oldNewButtonsBottom);

  let galleries = document.querySelectorAll('div[class="notifications-by-date"]');
  for (const gallery of galleries) gallery.parentNode.removeChild(gallery);

  let gallery = document.getElementById("gallery-0");
  if (!gallery) {
    gallery = document.createElement("section");
    gallery.id = "gallery-0";
    gallery.className = "gallery messagecenter with-checkboxes s-250 ";
    messageCenter.appendChild(gallery);
  }

  gallery.innerHTML = "";

  let favsDecomp = await decompressString(localStorage.getItem("favs"));
  let figures = JSON.parse(favsDecomp);
  let parser = new DOMParser();
  figures = figures.map((figure) => parser.parseFromString(figure, "text/html").body.firstChild);
  console.log('Loading "' + figures.length + '" figures');

  figures.forEach((figure) => gallery.appendChild(figure));
}

async function getUnreadFavsLengthAll(button) {
  const watchersDoc = await getHTML("https://www.furaffinity.net/controls/buddylist/1/");
  let firstwatcherSaved = watchersDoc.querySelector('div[class="flex-item-watchlist aligncenter"]').querySelector("a[href]").href;
  let firstwatcher = "";
  let watchers = Array.from(watchersDoc.querySelectorAll('div[class="flex-item-watchlist aligncenter"]'));
  let i = 1;
  while (firstwatcherSaved != firstwatcher) {
    i++;
    firstwatcher = firstwatcherSaved;
    let watchersDocNew = await getHTML("https://www.furaffinity.net/controls/buddylist/" + i + "/");
    firstwatcherSaved = watchersDocNew.querySelector('div[class="flex-item-watchlist aligncenter"]').querySelector("a[href]").href;
    if (firstwatcherSaved != firstwatcher) {
      let watchersNew = Array.from(watchersDocNew.querySelectorAll('div[class="flex-item-watchlist aligncenter"]'));
      watchers = watchers.concat(watchersNew);
    }
  }
  totalLength = watchers.length;
  console.log('You are watching "' + totalLength + '" people');
  console.log("Scanning for unseen Favs...");
  figureCount = 0;

  let newFavsAll = [];
  for (const watcher of watchers) {
    const watcherLink = watcher.querySelector("a").href;
    if (intSavedUsers.includes(watcherLink)) continue;
    let newFavs = await getUnreadFavsWatcher(watcherLink);
    if (newFavs) newFavsAll = newFavsAll.concat(newFavs);
    if (firstStart) button.textContent = " WF Initializing: " + percent.toFixed(2) + "%";
    else button.textContent = " WF: " + percent.toFixed(2) + "%";
  }
  if (figureCount != 0 && !firstStart) {
    button.setAttribute("loading", false);
    button.textContent = figureCount + "WF";
    button.onclick = start;
  } else button.parentNode.removeChild(button);
  if (firstStart) {
    localStorage.setItem("lastFavs", JSON.stringify(lastFavs));
    firstStart = false;
  }
  totalLength = 0;
  return newFavsAll;
}

async function getUnreadFavsWatcher(watcher) {
  let user = watcher.substring(0, watcher.length - 1);
  user = user.substring(user.lastIndexOf("/"), user.length);
  user = user.substring(1, user.length);

  percent = (currentLength / totalLength) * 100;
  currentLength++;
  if (excludedUsers.includes(user)) {
    console.log(percent.toFixed(2) + "% | " + user + " is excluded");
    return;
  } else console.log(percent.toFixed(2) + "% | " + user);

  const lastFavsTemp = JSON.parse(localStorage.getItem("lastFavs"));
  let userInLastFavs = false;
  if (lastFavsTemp && user in lastFavsTemp) userInLastFavs = true;
  let figuresAll = [];
  let lastFigureIndex = -1;
  let i = 0;
  let firstSite;
  while (lastFigureIndex == -1) {
    i++;
    let favLink = "https://www.furaffinity.net/favorites/" + user + "/" + i;
    let favs = await getHTML(favLink);
    if (firstSite == null) firstSite = favs;
    if (!favs) break;
    const figures = Array.from(favs.getElementsByTagName("figure"));
    if (!figures || figures.length == 0) break;
    if (userInLastFavs) lastFigureIndex = figures.findIndex((figure) => figure.id == lastFavsTemp[user]);
    figuresAll = figuresAll.concat(figures);
    if (figuresAll.length >= maxFavsLength) break;
    if (firstStart) {
      lastFigureIndex = figuresAll.length;
      break;
    }
  }

  //Some Bug still occurs
  if (firstSite.getElementById("no-images")) {
    console.log(user + " gets excluded");
    let excludeButton = document.getElementById("excludeButton_" + user);
    //excludeUser(watcher, excludeButton);
    return;
  }

  if (lastFigureIndex == -1) lastFigureIndex = figuresAll.length;

  const figuresBefore = figuresAll.slice(0, lastFigureIndex);

  lastFavs[user] = figuresAll[0].id;

  let newFavs = [];
  for (const figure of figuresBefore) {
    let figcaption = figure.getElementsByTagName("figcaption")[0];
    let byElem = figcaption.childNodes[1].cloneNode(true);
    byElem.querySelector("a[href]").style.fontWeight = "400";
    figcaption.appendChild(byElem);
    figcaption.childNodes[1].getElementsByTagName("i")[0].textContent = "from";
    figcaption.childNodes[1].getElementsByTagName("a")[0].title = user;
    figcaption.childNodes[1].getElementsByTagName("a")[0].textContent = user;
    figcaption.childNodes[1].getElementsByTagName("a")[0].href = "https://www.furaffinity.net/favorites/" + user;
    newFavs.push(figure);
  }
  figureCount += figuresBefore.length;
  let newCurrScanFavs = newFavs.map((figure) => figure.outerHTML);
  currScanFavs = currScanFavs.concat(newCurrScanFavs);
  intSavedUsers.push(watcher);
  localStorage.setItem("wfloadingusers", JSON.stringify(intSavedUsers));
  localStorage.setItem("wfloadingpercent", percent.toFixed(2));
  /*
  var currScanFavsComp = await compressString(JSON.stringify(currScanFavs));
  localStorage.setItem("wfloading", currScanFavsComp);*/
  setCompLocalStorageArrayItemAsync("wfloading", currScanFavs);
  //--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  return newFavs;
}

async function createLastXFavsButton() {
  let lastXFavsButton = document.createElement("a");
  lastXFavsButton.id = "lastXFavsButton";
  lastXFavsButton.className = "notification-container inline";
  lastXFavsButton.textContent = "Load last x Favs";
  lastXFavsButton.title = "Show last X Favorites";
  lastXFavsButton.style.cursor = "pointer";
  lastXFavsButton.onclick = function () {
    currentLength = 0;
    let amount = prompt("Enter the amount of Favs you want to load: ");
    while (amount && isNaN(parseInt(amount))) amount = prompt("Input was not a Number. Please enter the amount of Favs you want to load: ");
    if (amount && amount > 0) loadLastXFavsOfAllUsers(lastXFavsButton, amount);
  };
  document.getElementsByClassName("message-bar-desktop")[0].appendChild(lastXFavsButton);
}

async function loadLastXFavsOfAllUsers(button, x) {
  const watchersDoc = await getHTML("https://www.furaffinity.net/controls/buddylist/1/");
  let firstwatcherSaved = watchersDoc.querySelector('div[class="flex-item-watchlist aligncenter"]').querySelector("a[href]").href;
  let firstwatcher = "";
  let watchers = Array.from(watchersDoc.querySelectorAll('div[class="flex-item-watchlist aligncenter"]'));
  let i = 1;
  while (firstwatcherSaved != firstwatcher) {
    i++;
    firstwatcher = firstwatcherSaved;
    let watchersDocNew = await getHTML("https://www.furaffinity.net/controls/buddylist/" + i + "/");
    firstwatcherSaved = watchersDocNew.querySelector('div[class="flex-item-watchlist aligncenter"]').querySelector("a[href]").href;
    if (firstwatcherSaved != firstwatcher) {
      let watchersNew = Array.from(watchersDocNew.querySelectorAll('div[class="flex-item-watchlist aligncenter"]'));
      watchers = watchers.concat(watchersNew);
    }
  }
  totalLength = watchers.length;
  console.log('You are watching "' + totalLength + '" people');
  console.log('Searching last "' + x + '" Favs...');
  figureCount = 0;
  let newFavsAll = [];
  for (const watcher of watchers) {
    const watcherLink = watcher.querySelector("a").href;
    let newFavs = await getLastXFavsOfUser(watcherLink, x);
    if (newFavs) newFavsAll = newFavsAll.concat(newFavs);
    button.textContent = " WF Last " + x + ": " + percent.toFixed(2) + "%";
  }
  if (figureCount != 0) {
    button.setAttribute("loading", false);
    button.textContent = figureCount + "WF";
    totalLength = 0;
    localStorage.setItem("clicked", true.toString());
    newFavsAll = Array.from(newFavsAll);
    newFavsAll = newFavsAll.map((newFav) => newFav.outerHTML);
    var favsComp = await compressString(JSON.stringify(newFavsAll));
    localStorage.setItem("favs", favsComp);
    window.location.href = "https://www.furaffinity.net/msg/submissions/";
  } else button.parentNode.removeChild(button);
  totalLength = 0;
}

async function getLastXFavsOfUser(watcher, x) {
  let user = watcher.substring(0, watcher.length - 1);
  user = user.substring(user.lastIndexOf("/"), user.length);
  user = user.substring(1, user.length);

  percent = (currentLength / totalLength) * 100;
  currentLength++;
  if (excludedUsers.includes(user)) {
    console.log(percent.toFixed(2) + "% | " + user + " is excluded");
    return;
  } else console.log(percent.toFixed(2) + "% | " + user);

  let favLink = "https://www.furaffinity.net/favorites/" + user + "/";
  let favs = await getHTML(favLink);
  if (!favs) return;
  const figures = Array.from(favs.getElementsByTagName("figure"));
  if (!figures) return;

  if (figures.length == 0) return;

  const figuresBefore = figures.slice(0, x);

  let newFavs = [];
  for (const figure of figuresBefore) {
    let figcaption = figure.getElementsByTagName("figcaption")[0];
    let byElem = figcaption.childNodes[1].cloneNode(true);
    byElem.querySelector("a[href]").style.fontWeight = "400";
    figcaption.appendChild(byElem);
    figcaption.childNodes[1].getElementsByTagName("i")[0].textContent = "from";
    figcaption.childNodes[1].getElementsByTagName("a")[0].title = user;
    figcaption.childNodes[1].getElementsByTagName("a")[0].textContent = user;
    figcaption.childNodes[1].getElementsByTagName("a")[0].href = "https://www.furaffinity.net/favorites/" + user;
    newFavs.push(figure);
  }
  figureCount += figuresBefore.length;
  return newFavs;
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

async function addWFSettings() {
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

async function addWFSettingsSidebar() {
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

async function createSettings() {
  localStorage.setItem("wfsettings", false.toString());
  const columnPage = document.getElementById("columnpage");
  let content = columnPage.querySelector('div[class="content"]');
  for (const section of content.querySelectorAll('section:not([class="exsettings"])')) section.parentNode.removeChild(section);

  let section = document.createElement("section");
  section.className = "exsettings";
  let headerContainer = document.createElement("div");
  headerContainer.className = "section-header";
  let header = document.createElement("h2");
  header.textContent = "Watches Favorite Viewer Settings";
  headerContainer.appendChild(header);
  section.appendChild(headerContainer);
  let bodyContainer = document.createElement("div");
  bodyContainer.className = "section-body";
  let Item1 = document.createElement("div");
  Item1.className = "control-panel-item-container";
  let Item1Name = document.createElement("div");
  Item1Name.className = "control-panel-item-name";
  let Item1NameText = document.createElement("h4");
  Item1NameText.textContent = "Last X Favs";
  Item1Name.appendChild(Item1NameText);
  Item1.appendChild(Item1Name);
  let Item1Desc = document.createElement("div");
  Item1Desc.className = "control-panel-item-description";
  let Item1DescText = document.createTextNode("Sets wether the Load last x Favs buttons appears after a new Fav scan found no new Favs.");
  Item1Desc.appendChild(Item1DescText);
  Item1.appendChild(Item1Desc);
  let Item1Option = document.createElement("div");
  Item1Option.className = "control-panel-item-options";
  let Item1OptionContainer = document.createElement("div");
  let Item1OptionElem1 = document.createElement("input");
  Item1OptionElem1.id = "wfsettings_01";
  Item1OptionElem1.type = "checkbox";
  Item1OptionElem1.style.cursor = "pointer";
  Item1OptionElem1.style.marginRight = "4px";
  Item1OptionElem1.addEventListener("change", function () {
    showLoadLastXFavsButton = Item1OptionElem1.checked;
    localStorage.setItem("wfsetting_01", showLoadLastXFavsButton.toString());
  });
  Item1OptionContainer.appendChild(Item1OptionElem1);
  let Item1OptionElem2 = document.createTextNode("Show Last X Favs Button");
  Item1OptionContainer.appendChild(Item1OptionElem2);
  Item1Option.appendChild(Item1OptionContainer);
  Item1.appendChild(Item1Option);
  bodyContainer.appendChild(Item1);
  let Item2 = document.createElement("div");
  Item2.className = "control-panel-item-container";
  let Item2Name = document.createElement("div");
  Item2Name.className = "control-panel-item-name";
  let Item2NameText = document.createElement("h4");
  Item2NameText.textContent = "Max Favs Loaded";
  Item2Name.appendChild(Item2NameText);
  Item2.appendChild(Item2Name);
  let Item2Desc = document.createElement("div");
  Item2Desc.className = "control-panel-item-description";
  let Item2DescText = document.createTextNode("Sets the maximum number of Favs loaded");
  Item2Desc.appendChild(Item2DescText);
  Item2.appendChild(Item2Desc);
  let Item2Option = document.createElement("div");
  Item2Option.className = "control-panel-item-options";
  let Item2OptionContainer = document.createElement("div");
  let Item2OptionElem1 = document.createElement("input");
  Item2OptionElem1.id = "wfsettings_02";
  Item2OptionElem1.type = "text";
  Item2OptionElem1.className = "textbox";
  Item2OptionElem1.addEventListener("input", function () {
    this.value = this.value.replace(/[^0-9]/g, "");
    maxFavsLength = +this.value;
    localStorage.setItem("wfsetting_02", maxFavsLength.toString());
  });
  Item2OptionContainer.appendChild(Item2OptionElem1);
  Item2Option.appendChild(Item2OptionContainer);
  Item2.appendChild(Item2Option);
  bodyContainer.appendChild(Item2);
  let Item3 = document.createElement("div");
  Item3.className = "control-panel-item-container";
  let Item3Name = document.createElement("div");
  Item3Name.className = "control-panel-item-name";
  let Item3NameText = document.createElement("h4");
  Item3NameText.textContent = "Reset Synchronisation Error";
  Item3Name.appendChild(Item3NameText);
  Item3.appendChild(Item3Name);
  let Item3Desc = document.createElement("div");
  Item3Desc.className = "control-panel-item-description";
  let Item3DescText = document.createTextNode("Resets the synchronisation variable to fix the error that no scan will start");
  Item3Desc.appendChild(Item3DescText);
  Item3.appendChild(Item3Desc);
  let Item3Option = document.createElement("div");
  Item3Option.className = "control-panel-item-options";
  let Item3OptionContainer = document.createElement("div");
  let Item3OptionElem1 = document.createElement("button");
  Item3OptionElem1.id = "wfsettings_03";
  Item3OptionElem1.type = "button";
  Item3OptionElem1.className = "button standard mobile-fix";
  Item3OptionElem1.textContent = "Reset Loadingstate";
  Item3OptionElem1.onclick = function () {
    localStorage.removeItem("wfloadingstate");
    if (localStorage.getItem("wfloadingstate") == null) {
      Item3OptionElem1.textContent = "<---- Success ---->";
      setTimeout(() => {
        Item3OptionElem1.textContent = "Reset Loadingstate";
      }, 3000);
    } else {
      Item3OptionElem1.textContent = "<---- Failed ---->";
      setTimeout(() => {
        Item3OptionElem1.textContent = "Reset Loadingstate";
      }, 3000);
    }
  };
  Item3OptionContainer.appendChild(Item3OptionElem1);
  Item3Option.appendChild(Item3OptionContainer);
  Item3.appendChild(Item3Option);
  bodyContainer.appendChild(Item3);
  section.appendChild(bodyContainer);
  content.appendChild(section);

  fillSettings();
}

async function fillSettings() {
  let setting1 = document.getElementById("wfsettings_01");
  setting1.checked = showLoadLastXFavsButton;

  let setting3 = document.getElementById("wfsettings_02");
  setting2.value = maxFavsLength.toString();
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
