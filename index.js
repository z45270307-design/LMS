// ==========================================
// Cloudflare Worker + D1 CRUD
// Artikel, Materi, Ujian
// ==========================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
};

async function verifyJWT(request, secretKey) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.split(" ")[1];

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadB64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const payload = JSON.parse(atob(payloadB64));

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function getIdFromPath(path) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

function safeJsonParse(value, fallback = []) {
  try {
    if (typeof value === "string") return JSON.parse(value);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

// ==========================================
// MODELS
// ==========================================

const ArticleModel = {
  async getAll(db) {
    const { results } = await db
      .prepare("SELECT * FROM articles ORDER BY rowid DESC")
      .all();
    return results;
  },

  async getById(db, id) {
    return await db
      .prepare("SELECT * FROM articles WHERE id = ?")
      .bind(id)
      .first();
  },

  async create(db, { id, title, content, author }) {
    await db
      .prepare("INSERT INTO articles (id, title, content, author) VALUES (?, ?, ?, ?)")
      .bind(id, title, content, author)
      .run();
  },

  async update(db, id, { title, content }) {
    await db
      .prepare(
        "UPDATE articles SET title = ?, content = ? WHERE id = ?"
      )
      .bind(title, content, id)
      .run();
  },

  async delete(db, id) {
    await db.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
  },
};

const MateriModel = {
  async getAll(db) {
    const { results } = await db
      .prepare("SELECT * FROM materi ORDER BY rowid DESC")
      .all();
    return results;
  },

  async getById(db, id) {
    return await db
      .prepare("SELECT * FROM materi WHERE id = ?")
      .bind(id)
      .first();
  },

  async create(db, { id, title, content }) {
    await db
      .prepare("INSERT INTO materi (id, title, content) VALUES (?, ?, ?)")
      .bind(id, title, content)
      .run();
  },

  async update(db, id, { title, content }) {
    await db
      .prepare("UPDATE materi SET title = ?, content = ? WHERE id = ?")
      .bind(title, content, id)
      .run();
  },

  async delete(db, id) {
    await db.prepare("DELETE FROM materi WHERE id = ?").bind(id).run();
  },
};

const ExamModel = {
  async getAll(db) {
    const { results } = await db
      .prepare("SELECT * FROM exams ORDER BY rowid DESC")
      .all();

    return results.map((row) => ({
      ...row,
      questions: safeJsonParse(row.questions, []),
    }));
  },

  async getById(db, id) {
    const row = await db
      .prepare("SELECT * FROM exams WHERE id = ?")
      .bind(id)
      .first();

    if (!row) return null;
    return {
      ...row,
      questions: safeJsonParse(row.questions, []),
    };
  },

  async create(db, { id, title, description, duration, questions }) {
    const questionsStr =
      typeof questions === "string" ? questions : JSON.stringify(questions);

    await db
      .prepare(
        "INSERT INTO exams (id, title, description, duration, questions) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(id, title, description, parseInt(duration, 10), questionsStr)
      .run();
  },

  async update(db, id, { title, description, duration, questions }) {
    const questionsStr =
      typeof questions === "string" ? questions : JSON.stringify(questions);

    await db
      .prepare(
        "UPDATE exams SET title = ?, description = ?, duration = ?, questions = ? WHERE id = ?"
      )
      .bind(title, description, parseInt(duration, 10), questionsStr, id)
      .run();
  },

  async delete(db, id) {
    await db.prepare("DELETE FROM exams WHERE id = ?").bind(id).run();
  },
};

// ==========================================
// ROUTER
// ==========================================

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const db = env.DB;
    const JWT_SECRET = env.JWT_SECRET || "super-secret-key";

    // ==========================================
    // API ROUTES
    // ==========================================
    if (path.startsWith("/api")) {
      const user = await verifyJWT(request, JWT_SECRET);

      if (!user) {
        return jsonResponse(
          { success: false, error: "Unauthorized: invalid or missing token" },
          401
        );
      }

      try {
        // -------------------------------------------------
        // MATERI
        // -------------------------------------------------
        if (path === "/api/materi") {
          if (method === "GET") {
            const materi = await MateriModel.getAll(db);
            return jsonResponse({ success: true, data: materi });
          }

          if (method === "POST") {
            const body = await request.json();

            if (!body.title || !body.content) {
              return jsonResponse(
                { success: false, error: "Judul dan isi materi wajib diisi" },
                400
              );
            }

            const newMateri = {
              id: crypto.randomUUID(),
              title: String(body.title).trim(),
              content: String(body.content).trim(),
            };

            await MateriModel.create(db, newMateri);

            return jsonResponse(
              { success: true, message: "Materi berhasil disimpan", data: newMateri },
              201
            );
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        if (path.startsWith("/api/materi/")) {
          const id = getIdFromPath(path);

          if (!id) {
            return jsonResponse({ success: false, error: "ID materi tidak ditemukan" }, 400);
          }

          if (method === "PUT") {
            const body = await request.json();

            if (!body.title || !body.content) {
              return jsonResponse(
                { success: false, error: "Judul dan isi materi wajib diisi" },
                400
              );
            }

            await MateriModel.update(db, id, {
              title: String(body.title).trim(),
              content: String(body.content).trim(),
            });

            return jsonResponse({
              success: true,
              message: "Materi berhasil diperbarui",
            });
          }

          if (method === "DELETE") {
            await MateriModel.delete(db, id);
            return jsonResponse({
              success: true,
              message: "Materi berhasil dihapus",
            });
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        // -------------------------------------------------
        // ARTIKEL
        // -------------------------------------------------
        if (path === "/api/articles") {
          if (method === "GET") {
            const articles = await ArticleModel.getAll(db);
            return jsonResponse({ success: true, data: articles });
          }

          if (method === "POST") {
            const body = await request.json();

            if (!body.title || !body.content) {
              return jsonResponse(
                { success: false, error: "Title dan content wajib diisi" },
                400
              );
            }

            const newArticle = {
              id: crypto.randomUUID(),
              title: String(body.title).trim(),
              content: String(body.content).trim(),
              author: user.username || "Anonymous",
            };

            await ArticleModel.create(db, newArticle);

            return jsonResponse(
              { success: true, message: "Article created", data: newArticle },
              201
            );
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        if (path.startsWith("/api/articles/")) {
          const id = getIdFromPath(path);

          if (method === "PUT") {
            const body = await request.json();

            await ArticleModel.update(db, id, {
              title: String(body.title || "").trim(),
              content: String(body.content || "").trim(),
            });

            return jsonResponse({
              success: true,
              message: "Article updated successfully",
            });
          }

          if (method === "DELETE") {
            await ArticleModel.delete(db, id);
            return jsonResponse({
              success: true,
              message: "Article deleted successfully",
            });
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        // -------------------------------------------------
        // UJIAN
        // -------------------------------------------------
        if (path === "/api/exams") {
          if (method === "GET") {
            const exams = await ExamModel.getAll(db);
            return jsonResponse({ success: true, data: exams });
          }

          if (method === "POST") {
            let body;
            try {
              body = await request.json();
            } catch (err) {
              return jsonResponse(
                { success: false, error: "Format JSON tidak valid" },
                400
              );
            }

            if (!body.title || !body.duration || !body.questions) {
              return jsonResponse(
                {
                  success: false,
                  error: "Title, duration, dan questions wajib diisi",
                  received: body || null,
                },
                400
              );
            }

            const newExam = {
              id: body.id || "exam-" + Date.now(),
              title: String(body.title).trim(),
              description: String(body.description || "").trim(),
              duration: body.duration,
              questions: body.questions,
            };

            await ExamModel.create(db, newExam);

            return jsonResponse(
              { success: true, message: "Exam created successfully", data: newExam },
              201
            );
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        if (path.startsWith("/api/exams/")) {
          const id = getIdFromPath(path);

          if (method === "PUT") {
            const body = await request.json();

            await ExamModel.update(db, id, {
              title: String(body.title || "").trim(),
              description: String(body.description || "").trim(),
              duration: body.duration,
              questions: body.questions,
            });

            return jsonResponse({
              success: true,
              message: "Exam updated successfully",
            });
          }

          if (method === "DELETE") {
            await ExamModel.delete(db, id);
            return jsonResponse({
              success: true,
              message: "Exam deleted successfully",
            });
          }

          return jsonResponse({ success: false, error: "Method tidak didukung" }, 405);
        }

        return jsonResponse({ success: false, error: "Endpoint not found" }, 404);
      } catch (error) {
        return jsonResponse(
          {
            success: false,
            error: "Internal Server Error",
            details: error.message,
          },
          500
        );
      }
    }

    // ==========================================
    // STATIC ASSETS
    // ==========================================
    return env.ASSETS.fetch(request);
  },
};
