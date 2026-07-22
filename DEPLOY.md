# 배포 가이드

이 앱은 **Next.js 프론트(apps/web)** + **NestJS 백엔드(apps/api)** + **PostgreSQL** 구성입니다.
백엔드는 상시 프로세스(동적 크론 + 에이전트 CLI 서브프로세스 실행)가 필요해
**서버리스(Vercel)에 백엔드를 올릴 수 없습니다.** 두 가지 배포 방식이 있습니다.

---

## 선택 A — Vercel(프론트) + 상시 호스트(백엔드)

### A-1. 백엔드 → Render (예시)

1. `render.yaml`이 저장소에 있으므로 Render 대시보드 → **New > Blueprint** → 저장소 연결.
2. 생성되는 `claude-db`(Postgres) + `claude-api`(Docker) 확인.
3. 백엔드 환경변수 입력:
   - `ENCRYPTION_KEY` = `openssl rand -base64 32` 결과 (32바이트 base64)
   - `WEB_ORIGIN` = Vercel 프론트 도메인 (예: `https://claude-app.vercel.app`)
   - `ANTHROPIC_OAUTH_TOKEN` = (선택) 활성 Claude 계정이 없을 때 폴백 OAuth 토큰
   - `DATABASE_URL`, `JWT_SECRET`은 자동 연결/생성됨
4. 배포되면 API 주소 확인 (예: `https://claude-api.onrender.com`). 마이그레이션은
   컨테이너 시작 시 `prisma migrate deploy`로 자동 적용됩니다.

> Railway/Fly.io도 동일 개념 — `apps/api/Dockerfile`을 그대로 쓰면 됩니다.

### A-2. 프론트 → Vercel

1. Vercel → New Project → 저장소 연결.
2. **Root Directory = `apps/web`** 로 설정 (pnpm 워크스페이스는 자동으로 루트에서 설치됨).
3. 환경변수: `NEXT_PUBLIC_API_URL = https://<백엔드주소>/api`
   (예: `https://claude-api.onrender.com/api`) — **빌드 시점에 박히므로 먼저 설정**.
4. Deploy. `apps/web/vercel.json`이 install/build 명령을 지정합니다.

### A-3. 연결 확인
- 백엔드 `WEB_ORIGIN`에 Vercel 도메인이 포함돼야 CORS 통과 (`main.ts`에서 처리).

---

## 선택 B — 한 호스트에 전부 (Docker Compose)

Vercel 없이 web+api+db를 한 곳에서 실행합니다. 로컬 개발에도 동일하게 사용.

```bash
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export JWT_SECRET=$(openssl rand -hex 32)
# (선택) export ANTHROPIC_OAUTH_TOKEN=sk-ant-oat01-...
docker compose up --build
#   web → http://localhost:3000
#   api → http://localhost:3001/api
```

외부 배포 시에는 `docker-compose.yml`의 `web.build.args.NEXT_PUBLIC_API_URL`을
실제 공개 API 주소로 바꿔서 빌드하세요(프론트에 정적으로 박히므로).

---

## 환경변수 요약

### 백엔드 (apps/api)
| 변수 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 접속 URL |
| `ENCRYPTION_KEY` | ✅ | 자격증명 암호화 키. `openssl rand -base64 32` (32바이트 base64) |
| `JWT_SECRET` | ✅ | JWT 서명 시크릿 |
| `JWT_EXPIRES_IN` |  | 토큰 만료 (기본 `7d`) |
| `WEB_ORIGIN` |  | CORS 허용 오리진(쉼표 구분). 프론트 도메인 |
| `ANTHROPIC_OAUTH_TOKEN` |  | 활성 Claude 계정이 없을 때 폴백 OAuth 토큰 |
| `PORT` |  | 기본 3001 |

### 프론트 (apps/web)
| 변수 | 필수 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | 백엔드 API 베이스 URL (예: `https://.../api`). **빌드 시점 주입** |

---

## 에이전트 실행에 대한 주의

에이전트 실제 실행은 백엔드 호스트에서 Claude Code CLI 서브프로세스를 띄우고,
프로젝트별 작업 디렉터리(`cwd`, git 체크아웃)에서 동작합니다. 따라서 백엔드 호스트는
**컨테이너/VM(상시 프로세스 + 쓰기 가능 파일시스템)** 이어야 하며, 서버리스에서는
동작하지 않습니다. 관리·공유·이슈 등록 등 나머지 기능은 제약이 없습니다.
