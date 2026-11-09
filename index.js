yytyconst encoder = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode64(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hash(value) {
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64url(new Uint8Array(result));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  );
}

async function createToken(email, secret) {
  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256" })));

  const payload = base64url(encoder.encode(JSON.stringify({
    email,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  })));

  const content = header + "." + payload;
  const signature = base64url(await hmac(content, secret));

  return content + "." + signature;
}

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token || !env.AUTH_SECRET) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const content = parts[0] + "." + parts[1];
    const expected = base64url(await hmac(content, env.AUTH_SECRET));

    if (expected !== parts[2]) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(decode64(parts[1]))
    );

    if (!payload.email || payload.exp < Date.now()) return null;

    return payload.email;
  } catch {
    return null;
  }
}

function validEmail(email) {
  return typeof email === "string" &&
    /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email);
}

async function accountKey(email) {
  return "accounts/" + await hash(email.toLowerCase()) + ".json";
}

async function conversationKey(first, second) {
  const emails = [first.toLowerCase(), second.toLowerCase()].sort();
  return hash(emails.join("|"));
}

async function getAccount(env, email) {
  return await env.DB.prepare(
    "SELECT email, created_at AS createdAt FROM accounts WHERE email = ?"
  ).bind(email).first();
}

async function saveMessage(env, conversation, message) {
  const id = crypto.randomUUID();
  const time = Date.now();

  const data = {
    id,
    ...message,
    createdAt: time
  };

  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, created_at, data_json) VALUES (?, ?, ?, ?)"
  ).bind(
    id,
    conversation,
    time,
    JSON.stringify(data)
  ).run();
}

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!env.DB) return json({ error: "D1 binding DB is missing." }, 500);

  if (!env.AUTH_SECRET) {
    return json({ error: "AUTH_SECRET is not configured." }, 500);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (path === "/api/signin" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();

    if (!validEmail(email)) {
      return json({ error: "Enter a valid Gmail address." }, 400);
    }

    let account = await getAccount(env, email);

    if (!account) {
      account = {
        email,
        createdAt: Date.now()
      };

      await env.DB.prepare(
  "INSERT INTO accounts (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING"
).bind(email, account.createdAt).run();

    const token = await createToken(email, env.AUTH_SECRET);

    return json({
      success: true,
      email,
      token
    });
  }

  const user = await authenticate(request, env);

  if (!user) {
    return json({ error: "Unauthorized. Please sign in." }, 401);
  }

  if (path === "/api/me" && request.method === "GET") {
    return json({ email: user });
  }

  if (path === "/api/contact" && request.method === "GET") {
    const email = String(url.searchParams.get("email") || "")
      .trim()
      .toLowerCase();

    if (!validEmail(email)) {
      return json({ error: "Invalid Gmail address." }, 400);
    }

    if (email === user) {
      return json({ error: "You cannot chat with yourself." }, 400);
    }

    const account = await getAccount(env, email);

    if (!account) {
      return json({ error: "Error 404: Contact not found." }, 404);
    }

    return json({
      found: true,
      email: account.email
    });
  }

  if (path === "/api/messages" && request.method === "GET") {
    const other = String(url.searchParams.get("with") || "")
      .trim()
      .toLowerCase();

    if (!validEmail(other) || other === user) {
      return json({ error: "Invalid contact." }, 400);
    }

    if (!a

    const listed = await env.DB.prepare(
  "SELECT data_json FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1000"
).bind(conversation).all();

const messages = listed.results.map(item =>
  JSON.parse(item.data_json)
);
    return json({ messages });
  }

  if (path === "/api/messages" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));

    const other = String(body.to || "").trim().toLowerCase();
    const message = String(body.message || "").trim();

    if (!validEmail(other) || other === user) {
      return json({ error: "Invalid contact." }, 400);
    }

    if (!message || message.length > 4000) {
      return json({ error: "Message must contain 1–4000 characters." }, 400);
    }

    if (!await getAccount(env, other)) {
      return json({ error: "Error 404: Contact not found." }, 404);
    }

    const conversation = await conversationKey(user, other);

    await saveMessage(env, conversation, {
      from: user,
      to: other,
      message,
      type: "text"
    });

    return json({ success: true });
  }

  if (path === "/api/files" && request.method === "POST") {
    const form = await request.formData();

    const other = String(form.get("to") || "").trim().toLowerCase();
    const file = form.get("file");

    if (!validEmail(other) || other === user) {
      return json({ error: "Invalid contact." }, 400);
    }

    if (!await getAccount(env, other)) {
      return json({ error: "Error 404: Contact not found." }, 404);
    }

    if (!(file instanceof File) || !file.size) {
      return json({ error: "Select a file." }, 400);
    }
      if (file.size > 1.8 * 1024 * 1024) {
  return json({ error: "Maximum file size is 1.8 MB." }, 413);
      }
    const conversation = await conversationKey(user, other);
const id = crypto.randomUUID();

const safeName = file.name.replace(/[\\/"\r\n]/g, "_").slice(0, 150);
const contentType = file.type || "application/octet-stream";
const fileData = new Uint8Array(await file.arrayBuffer());

const chunkSize = 256 * 1024;
const createdAt = Date.now();
const messageId = crypto.randomUUID();

const messageData = {
  id: messageId,
  from: user,
  to: other,
  type: "file",
  file: {
    id,
    name: safeName,
    size: file.size,
    contentType
  },
  createdAt
};

const statements = [
  env.DB.prepare(
    "INSERT INTO files (id, conversation_id, from_email, to_email, name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    id,
    conversation,
    user,
    other,
    safeName,
    contentType,
    file.size,
    createdAt
  ),

  env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, created_at, data_json) VALUES (?, ?, ?, ?)"
  ).bind(
    messageId,
    conversation,
    createdAt,
    JSON.stringify(messageData)
  )
];

for (
  let offset = 0, index = 0;
  offset < fileData.length;
  offset += chunkSize, index++
) {
  statements.push(
    env.DB.prepare(
      "INSERT INTO file_chunks (file_id, chunk_index, data) VALUES (?, ?, ?)"
    ).bind(
      id,
      index,
      fileData.slice(offset, offset + chunkSize)
    )
  );
}

await env.DB.batch(statements);

return json({ success: true });
    
    const id = crypto.randomUUID();

    const safeName = file.name.replace(/[\\/"\r\n]/g, "_").slice(0, 150);

    const key = `uploads/${conversation}/${id}`;

    await env.DATA.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream"
      },
      customMetadata: {
        from: user,
        to: other,
        name: safeName
      }
    });

    await saveMessage(env, conversation, {
      from: user,
      to: other,
      type: "file",
      file: {
        id,
        name: safeName,
        size: file.size,
        contentType: file.type || "application/octet-stream"
      }
    });

    return json({ success: true });
  }

  if (path.startsWith("/api/files/") && request.method === "GET") {
    const id = path.slice("/api/files/".length);
    const other = String(url.searchParams.get("with") || "")
      .trim()
      .toLowerCase();

    if (!/^[a-f0-9-]{36}$/i.test(id) || !validEmail(other)) {
      return json({ error: "Invalid file request." }, 400);
    }

    const conversation = await conversationKey(user, other);

const metadata = await env.DB.prepare(
  "SELECT * FROM files WHERE id = ? AND conversation_id = ?"
).bind(id, conversation).first();

if (!metadata) {
  return json({ error: "File not found." }, 404);
}

if (metadata.from_email !== user && metadata.to_email !== user) {
  return json({ error: "Access denied." }, 403);
}

const chunks = await env.DB.prepare(
  "SELECT data FROM file_chunks WHERE file_id = ? ORDER BY chunk_index ASC"
).bind(id).all();

const bytes = new Uint8Array(metadata.size);
let offset = 0;

for (const chunk of chunks.results) {
  const data = new Uint8Array(chunk.data);

  if (offset + data.length > bytes.length) {
    return json({ error: "Invalid file data." }, 500);
  }

  bytes.set(data, offset);
  offset += data.length;
}

if (offset !== metadata.size) {
  return json({ error: "File data is incomplete." }, 500);
}

return new Response(bytes, {
  headers: {
    "Content-Type": metadata.content_type,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
    "Cache-Control": "private, no-store"
  }
});
