<div align="center">
  <img src="client/public/logo192.png" alt="SwiftTalk Logo" width="64" height="64">
  <h1>SwiftTalk</h1>
  <p><strong>Scalable Full-Stack Real-Time Messaging Application</strong></p>

  <p>
    <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19">
    <img src="https://img.shields.io/badge/Vite-6-646cff?logo=vite" alt="Vite">
    <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs" alt="Node.js">
    <img src="https://img.shields.io/badge/Express-4-000000?logo=express" alt="Express">
    <img src="https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio" alt="Socket.IO">
    <img src="https://img.shields.io/badge/Redis-Adapter-dc382d?logo=redis" alt="Redis">
    <img src="https://img.shields.io/badge/MySQL-8.0-4479a1?logo=mysql" alt="MySQL">
    <img src="https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb" alt="MongoDB">
    <img src="https://img.shields.io/badge/Prisma-ORM-2d3748?logo=prisma" alt="Prisma">
    <img src="https://img.shields.io/badge/Mongoose-8-880000?logo=mongoose" alt="Mongoose">
    <img src="https://img.shields.io/badge/Groq-LLaMA_3.3-f55036" alt="Groq AI">
  </p>
</div>

---

SwiftTalk is a modern, high-performance messaging platform built for scale. It features a **hybrid polyglot persistence architecture** (MySQL for relational identity, auth, and tasks; MongoDB for high-throughput chats, messages, and read receipts), decouples the REST API server from dedicated WebSocket instances using Redis pub/sub for horizontal scalability, and integrates AI assistance, web push notifications, and OAuth.

## ✨ Features

- **Real-Time Communication**: Instant delivery, live typing indicators, read receipts, and online/offline status via Socket.IO.
- **Polyglot Persistence**: Hybrid architecture pairing **MySQL (Prisma)** for strict ACID compliance (user accounts, authentication, sessions, tasks, blocklists) with **MongoDB (Mongoose)** for flexible, high-throughput chat rooms, messages, attachments, and receipts.
- **Scalable Architecture**: Dedicated WebSocket server (`:3002`) decoupled from REST API (`:3001`), horizontally scaled via `@socket.io/redis-adapter` and `@socket.io/redis-emitter`.
- **AI-Powered Assistance**: Smart replies, chat summarization, and message translation powered by Groq (LLaMA 3.3).
- **Rich Media & File Sharing**: Instant image previews, chunked file transfers for large attachments, and document sharing.
- **Direct & Group Chats**: 1-on-1 private messaging and group chats with admin management.
- **Robust Authentication**: JWT access & refresh token rotation, email OTP verification (Resend API), and OAuth 2.0 (Google & GitHub).
- **Privacy & Security**: User blocking, bcrypt password hashing, and granular CORS protection.

---

## 🏗️ Architecture & Services

<p align="center">
  <img src="assets/architecture.png" alt="SwiftTalk System Architecture" width="100%">
</p>

| Service              | Port    | Technology               | Purpose                                                 |
| :------------------- | :------ | :----------------------- | :------------------------------------------------------ |
| **Frontend Client**  | `3000`  | React 19, Vite           | Web application UI                                      |
| **REST API Server**  | `3001`  | Express, Prisma, Mongoose| Authentication, users, chats, messages, AI, uploads     |
| **WebSocket Server** | `3002`  | Socket.IO, Redis Adapter | Real-time events, messaging, presence, receipts         |
| **Redis**            | `6379`  | Redis 6.2                | Pub/Sub message broker, presence, & message cache       |
| **MySQL Database**   | `3306`  | MySQL 8.0 (Prisma)       | Users, auth, sessions, OTPs, tasks, blocklists          |
| **MongoDB Database** | `27017` | MongoDB 7.0 (Mongoose)   | Chats, messages, attachments, delivery/read receipts    |

---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

Make sure **Docker** and **Docker Compose** are installed:

```bash
# 1. Clone the repository
git clone https://github.com/RushiK8626/SwiftTalk-Chat-Messaging-App.git
cd SwiftTalk-Chat-Messaging-App

# 2. Setup environment variables
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Spin up all services
docker compose up -d
```

Access the client at **http://localhost:3000**.

---

### Option 2: Local Development

**Prerequisites**: Node.js 18+, MySQL 8.0, MongoDB 7.0+, and Redis 6.2+.

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install
cd ..

# 2. Configure environment
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Apply database migrations & sync data
cd server
npx prisma migrate dev

# Optional: Migrate existing chat data from MySQL to MongoDB
npm run db:migrate:mongo

# 4. Start backend (runs both REST API on :3001 and WS on :3002 concurrently)
npm run dev

# 5. Start frontend (in a separate terminal)
cd ../client
npm start
```

---

## ⚙️ Key Scripts

| Directory     | Command                   | Description                                                        |
| :------------ | :------------------------ | :----------------------------------------------------------------- |
| **`/server`** | `npm run dev`             | Runs both API (`:3001`) and WS (`:3002`) concurrently with nodemon |
| **`/server`** | `npm run dev:api`         | Runs REST API server only                                          |
| **`/server`** | `npm run dev:ws`          | Runs WebSocket server only                                         |
| **`/server`** | `npm run db:migrate:mongo`| Migrates chats, messages & receipts from MySQL to MongoDB          |
| **`/server`** | `npm run db:studio`       | Launches Prisma Studio GUI                                         |
| **`/client`** | `npm start`               | Starts Vite development server (`:3000`)                           |
| **`/client`** | `npm run build`           | Builds production bundle                                           |

---

## 🛡️ Tech Stack

- **Frontend**: React 19, Vite, React Router 7, Lucide Icons, SimpleBar
- **Backend**: Node.js, Express, Prisma ORM, Mongoose, Socket.IO, Redis Adapter/Emitter, Passport.js
- **Database & Cache**: MySQL 8.0 (Prisma), MongoDB 7.0 (Mongoose), Redis 6.2
- **AI & Integrations**: Groq API (LLaMA 3.3), Resend API, Web Push (VAPID)

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
