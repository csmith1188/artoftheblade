/* global io */

const onlineCountEl = document.getElementById("online-count");
const queueCountEl = document.getElementById("queue-count");
const queueStatusEl = document.getElementById("queue-status");
const joinBtn = document.getElementById("queue-join-btn");
const cancelBtn = document.getElementById("queue-cancel-btn");

const socket = io();
let searching = false;

function renderQueueUI() {
  if (searching) {
    queueStatusEl.textContent = "Searching for an opponent… stay on this page.";
    queueStatusEl.classList.add("is-searching");
    joinBtn.hidden = true;
    cancelBtn.hidden = false;
  } else {
    queueStatusEl.textContent = "Ready to search for an opponent.";
    queueStatusEl.classList.remove("is-searching");
    joinBtn.hidden = false;
    cancelBtn.hidden = true;
  }
}

socket.on("connect", () => {
  socket.emit("lobby:join");
});

socket.on("auth:required", () => {
  window.location.href = "/login";
});

socket.on("lobby:stats", ({ onlineCount, queueCount }) => {
  if (onlineCountEl) onlineCountEl.textContent = String(onlineCount ?? 0);
  if (queueCountEl) queueCountEl.textContent = String(queueCount ?? 0);
});

socket.on("queue:status", ({ searching: nextSearching }) => {
  searching = Boolean(nextSearching);
  renderQueueUI();
});

socket.on("queue:matched", ({ matchId, opponent }) => {
  queueStatusEl.textContent = `Match found vs ${opponent}! Entering arena…`;
  queueStatusEl.classList.add("is-matched");
  joinBtn.hidden = true;
  cancelBtn.hidden = true;
  window.location.href = `/play?mode=pvp&matchId=${encodeURIComponent(matchId)}`;
});

joinBtn?.addEventListener("click", () => {
  socket.emit("queue:join");
});

cancelBtn?.addEventListener("click", () => {
  socket.emit("queue:leave");
});

renderQueueUI();
