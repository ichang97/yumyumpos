# แผนการพัฒนา: โหมดรัน Local และ Docker ด้วย Node.js + SQLite (ไม่ต้องใช้ D1)

## สรุปข้อตกลงจากการออกแบบ
1. **สถาปัตยกรรม**: รันโหมด Local / Docker ด้วย **Node.js + SQLite** โดยใช้โค้ด Hono ชุดเดียวกับ `worker/index.js` (ไม่ต้องพึ่ง Wrangler / D1) และยังคง Deploy ขึ้น Cloudflare Workers + D1 ได้เหมือนเดิม
2. **Auth & สิทธิ์ Admin**: รองรับ 2 โหมดผ่าน ENV
   - โหมด Local / Docker ค่าเริ่มต้นปิด Cloudflare Access (`LOCAL_AUTH_MODE=off`) ใช้งานได้ทั้ง `localhost` และวง LAN พร้อมตั้งสิทธิ์ Admin ผ่าน ENV (`LOCAL_USER_EMAIL`, `LOCAL_USER_ADMIN` / `ADMIN_EMAILS`)
   - หากตั้งค่า `ACCESS_TEAM_DOMAIN` และ `ACCESS_AUD` ระบบจะบังคับตรวจ Cloudflare Access JWT เหมือนเดิมทันที
3. **ฐานข้อมูล**: ใช้ SQLite ไฟล์เดียวผ่าน `node:sqlite` (`DatabaseSync`) ในตัว Node 22 พร้อมระบบ **Auto-migrate** จากไฟล์ใน `migrations/` ตอนสตาร์ท และเก็บข้อมูลไว้ใน Volume `/app/data`
4. **Network & Docker**: รองรับ `localhost`, IP วง LAN และหลัง HTTPS Reverse Proxy ผ่าน `TRUST_PROXY=true` (`X-Forwarded-Proto` / `X-Forwarded-Host`), อัปเดต `Dockerfile` และเพิ่ม `docker-compose.yml` + `.env.example` (พอร์ต `8787`)
5. **npm scripts**: คงคำสั่ง Cloudflare เดิมทั้งหมด (`dev`, `build`, `deploy`, `test`) และเพิ่มชุดคำสั่ง Local (`dev:local`, `build:local`, `start:local`, `test:local`)

---

## ขั้นตอนการดำเนินงาน

### ขั้นตอนที่ 1: ติดตั้ง Dependency ที่จำเป็น
- ติดตั้ง `@hono/node-server` ใน `package.json` เพื่อรัน Hono app บน Node.js

### ขั้นตอนที่ 2: ปรับแต่ง `worker/` แบบ Backward-Compatible
1. **`worker/lib/accessAuth.js`**
   - เพิ่มเงื่อนไข Local no-auth เฉพาะกรณีที่ไม่มี token, ตั้งค่า `LOCAL_AUTH_MODE=off`, และไม่มี `ACCESS_TEAM_DOMAIN` กับ `ACCESS_AUD`
   - กำหนด `authUser` จาก `LOCAL_USER_EMAIL` และ `is_admin` จาก `ADMIN_EMAILS` หรือ `LOCAL_USER_ADMIN`
2. **`worker/index.js`**
   - เพิ่ม helper `resolveExpectedOrigin(c)` รองรับ `TRUST_PROXY=true` (`X-Forwarded-Proto` และ `X-Forwarded-Host`) ในการตรวจ Same-Origin CSRF สำหรับ `POST/PUT/PATCH/DELETE`

### ขั้นตอนที่ 3: สร้าง Local Runtime & SQLite Adapter (โฟลเดอร์ `local/`)
1. **`local/sqliteD1Adapter.js`**: ครอบ `DatabaseSync` จาก `node:sqlite` ให้มี Interface เหมือน Cloudflare D1 (`prepare`, `bind`, `all`, `first`, `run`, `batch`) พร้อม Auto-migrate จาก `migrations/*.sql` และบันทึกประวัติใน `d1_migrations`
2. **`local/rateLimiter.js`**: In-memory sliding-window rate limiter สำหรับ `PUBLIC_ORDER_LIMITER`
3. **`local/server.js`**: HTTP server บน `@hono/node-server` เชื่อม `/api/*` เข้า `worker/index.js` และเสิร์ฟ static files / SPA fallback จาก `dist/client` พร้อม Security Headers
4. **`local/dev.js`**: สคริปต์สำหรับ `npm run dev:local` สตาร์ท Node API server คู่กับ Vite dev server

### ขั้นตอนที่ 4: ปรับ Vite Config & `package.json` Scripts
1. **`vite.config.js`**: รองรับ `YUMYUM_LOCAL=1` เพื่อ build ออก `dist/client` โดยไม่โหลด `@cloudflare/vite-plugin` และตั้ง proxy `/api` ไปยัง Node API server
2. **`package.json`**: เพิ่ม `dev:local`, `build:local`, `start:local`, `test:local` โดยคงคำสั่ง Cloudflare เดิมไว้ทั้งหมด

### ขั้นตอนที่ 5: อัปเดต Docker, Compose, Env, Ignore Files และเอกสาร
1. **`Dockerfile`**: Multi-stage build ด้วย `npm run build:local`, runtime ใช้ non-root `node`, volume `/app/data`, healthcheck `/api/health`, รัน `node local/server.js`
2. **`docker-compose.yml`**: ตั้งค่า service พอร์ต `8787:8787`, named volume `yumyum_data:/app/data` และ ENV ค่าเริ่มต้น
3. **`.env.example`**, **`.gitignore`**, **`.dockerignore`**: เพิ่มเอกสาร ENV และป้องกันไฟล์ `.env` / ข้อมูลในเครื่องหลุดเข้า build context
4. **`README.md`**: เพิ่มคู่มือการรันโหมด Local และ Docker / Docker Compose

### ขั้นตอนที่ 6: การทดสอบและยืนยันผล
1. สร้าง `scripts/verify-local.js` ทดสอบ Auto-migrate, API พนักงาน/ครัว/รายงาน/Backup, Dual Auth mode, Public QR + rate limiter, Reverse Proxy CSRF, และ Static SPA fallback
2. รัน `npm run build:local`, `npm run test:local`, `npm run build`, และ `npm test` เพื่อยืนยันว่าทั้ง Local และ Cloudflare Workers ผ่านครบถ้วน
