# Dandiya Night Partner Portal
React+Vite+Tailwind client, Express+Socket.IO server, DynamoDB + S3.

## Setup
1. `cd server && cp .env.example .env` (fill JWT_SECRET, AWS_*), `npm i`, `npm run tables` (creates the 5 tables), `npm run dev`
2. `cd client && npm i && npm run dev` (proxies /api and /socket.io to :4000). Build: `npm run build`.
3. S3: private bucket; IAM user needs s3:PutObject/GetObject on it (photos served via 1-hour signed URLs). DynamoDB: dynamodb:* on the tables incl. TransactWriteItems.

## Tables
Users(userId; GSI emailIndex), Requests(requestId), Matches(matchId), Messages(matchId+messageId), Notifications(recipientId+notificationId).

## Matches table
Accepting a request runs ONE DynamoDB transaction: request -> ACCEPTED, Match put, notifications. matchId = `MATCH_<smallerUserId>_<largerUserId>` (pairKey = `small#large`), so one record per pair; a conditional put blocks duplicates. Record: matchId, pairKey, user1Id (sender), user2Id (receiver), user1Gender, user2Gender, requestId, status ACTIVE|UNMATCHED, matchedAt, createdAt, updatedAt. Unmatch only flips status; messages are kept.

## Courses/years
Edit `server/src/courses.js` (name, level, duration, lateral). Years derive from duration; the client reads `/api/config/courses`; the server re-validates.

## Security
bcrypt, JWT, helmet, CORS, rate limits, 3MB JPG/PNG/WEBP only, gender/active/match membership enforced server-side (REST and Socket.IO), email/mobile never in partner APIs.
