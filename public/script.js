const API = "/api";

let token = localStorage.getItem("cl_token");
let currentEmail = "";
let activeChat = "";
let refreshTimer = null;

const $ = id => document.getElementById(id);

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", "Bearer " + token);
  }

  if (options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && token) {
      logout();
    }

    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function showStatus(id, message) {
  $(id).textContent = message;
}

function enterApp(email) {
  currentEmail = email;

  $("signinSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  $("logoutButton").classList.remove("hidden");

  $("accountEmail").textContent = email;
  showStatus("signinStatus", "");
}

function logout() {
  localStorage.removeItem("cl_token");

  token = null;
  currentEmail = "";
  activeChat = "";

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  $("signinSection").classList.remove("hidden");
  $("appSection").classList.add("hidden");
  $("logoutButton").classList.add("hidden");
  $("chatContent").classList.add("hidden");
  $("emptyChat").classList.remove("hidden");

  $("gmailInput").value = "";
}

$("signinForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("gmailInput").value.trim().toLowerCase();

  showStatus("signinStatus", "Signing in...");

  try {
    const data = await request("/signin", {
      method: "POST",
      body: JSON.stringify({ email })
    });

    token = data.token;
    localStorage.setItem("cl_token", token);

    enterApp(data.email);
  } catch (error) {
    showStatus("signinStatus", error.message);
  }
});

$("logoutButton").addEventListener("click", logout);

async function restoreSession() {
  if (!token) return;

  try {
    const data = await request("/me");
    enterApp(data.email);
  } catch (error) {
    logout();
  }
}

$("contactForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("contactInput").value.trim().toLowerCase();

  showStatus("contactStatus", "Searching for contact...");

  try {
    const data = await request(
      "/contact?email=" + encodeURIComponent(email)
    );

    if (data.found) {
      openChat(data.email);
      $("contactInput").value = "";
      showStatus("contactStatus", "");
    }
  } catch (error) {
    showStatus("contactStatus", error.message);
  }
});

function openChat(email) {
  activeChat = email;

  $("emptyChat").classList.add("hidden");
  $("chatContent").classList.remove("hidden");
  $("chatEmail").textContent = email;

  loadMessages();

  if (refreshTimer) clearInterval(refreshTimer);

  refreshTimer = setInterval(() => {
    if (activeChat) loadMessages();
  }, 5000);
}

$("closeChatButton").addEventListener("click", () => {
  activeChat = "";

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  $("chatContent").classList.add("hidden");
  $("emptyChat").classList.remove("hidden");
});

async function loadMessages() {
  if (!activeChat) return;

  const contact = activeChat;

  try {
    const data = await request(
      "/messages?with=" + encodeURIComponent(contact)
    );

    if (activeChat !== contact) return;

    renderMessages(data.messages || []);
  } catch (error) {
    if (activeChat === contact) {
      showStatus("fileStatus", error.message);
    }
  }
}

function renderMessages(messages) {
  const container = $("messages");
  container.replaceChildren();

  for (const message of messages) {
    const item = document.createElement("div");

    item.className = "message" +
      (message.from === currentEmail ? " mine" : "");

    if (message.type === "file" && message.file) {
      const title = document.createElement("div");
      title.textContent = "📎 " + message.file.name;

      const details = document.createElement("small");
      details.textContent =
        (message.file.size / 1024).toFixed(1) + " KB";

      const download = document.createElement("button");
      download.type = "button";
      download.className = "download-button";
      download.textContent = "Download file";

      download.addEventListener("click", () => {
        downloadFile(message.file.id, message.file.name);
      });

      item.append(title, details, download);
    } else {
      const text = document.createElement("div");
      text.textContent = message.message || "";

      item.appendChild(text);
    }

    const time = document.createElement("small");
    time.textContent =
      new Date(message.createdAt).toLocaleString();

    item.appendChild(time);
    container.appendChild(item);
  }

  container.scrollTop = container.scrollHeight;
}

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const message = $("messageInput").value.trim();

  if (!message || !activeChat) return;

  const button = event.submitter;
  button.disabled = true;

  try {
    await request("/messages", {
      method: "POST",
      body: JSON.stringify({
        to: activeChat,
        message
      })
    });

    $("messageInput").value = "";
    await loadMessages();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("fileForm").addEventListener("submit", async event => {
  event.preventDefault();

  const file = $("fileInput").files[0];

  if (!file || !activeChat) {
    showStatus("fileStatus", "Choose a file first.");
    return;
  }

  showStatus("fileStatus", "Uploading...");

  const form = new FormData();

  form.append("to", activeChat);
  form.append("file", file);

  try {
    await request("/files", {
      method: "POST",
      body: form
    });

    $("fileInput").value = "";
    showStatus("fileStatus", "Upload complete!");

    await loadMessages();
  } catch (error) {
    showStatus("fileStatus", error.message);
  }
});

async function downloadFile(id, filename) {
  try {
    const response = await fetch(
      API + "/files/" + encodeURIComponent(id) +
      "?with=" + encodeURIComponent(activeChat),
      {
        headers: {
          "Authorization": "Bearer " + token
        }
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Download failed.");
    }

    const blob = await response.blob();
    const objectURL = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectURL;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(objectURL);
  } catch (error) {
    alert(error.message);
  }
}

restoreSession();
