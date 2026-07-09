# Authentication

LogEveryLift uses [Better Auth](https://www.better-auth.com/) with email + password. There is no public sign-up — an admin creates all accounts and distributes credentials to users. Sessions last 30 days and refresh automatically on activity.

---

## First-time setup

### 1. Set environment variables

Copy `.env.example` to `.env.local` and fill in the auth values:

```bash
# Generate a strong secret
openssl rand -base64 32
```

```env
BETTER_AUTH_SECRET=<output from above>
BETTER_AUTH_URL=http://localhost:3000   # or your production URL
```

In production these are passed via `docker-compose.yml` environment variables or your hosting platform's secrets manager.

### 2. Push the database schema

```bash
docker-compose exec app pnpm db:push
```

### 3. Set admin credentials in your environment

Add these to `.env.local` (or your hosting platform's secrets):

```env
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-strong-password
ADMIN_NAME=Your Name
```

When the app starts, it checks whether that email exists in the database. If not, it creates the account and promotes it to `admin` automatically. This happens once — subsequent restarts are a no-op once the account exists.

**After first login you can remove these variables** (or rotate the password via Settings) if you prefer not to keep credentials in env long-term.

#### Manual fallback

If you prefer not to use env variables, you can run the bootstrap script directly:

```bash
docker-compose exec app pnpm create-admin
```

---

## Managing users (admin only)

All user management is done from the app at **Settings → Manage Users** (`/settings/users`). Only accounts with the `admin` role can access this page.

### Create a user

1. Go to **Settings → Manage Users**
2. Fill in name, email, password, and role
3. Click **Create User**
4. Share the email and password with the person — they log in at `/login`

Password requirements: 8–128 characters.

### Delete a user

Click the delete button next to any user. This is permanent and cascades — all their programs, training cycles, and workout sessions are removed. You cannot delete your own account.

### Change a user's role

Toggle between `user` and `admin` using the role button next to each account. Promoting someone to `admin` gives them full access to user management.

---

## Roles

| Role    | Access                                      |
|---------|---------------------------------------------|
| `user`  | Own programs, cycles, and workout data only |
| `admin` | Everything a user can do + manage all accounts at `/settings/users` |

---

## Signing in

Navigate to `/login` and enter the email and password provided by the admin. The session cookie is set for 30 days and refreshed daily, so active users stay logged in indefinitely.

---

## Signing out

Go to **Settings** and tap **Sign out**. This clears the session cookie and redirects to `/login`.

---

## Resetting a user's workout data

To wipe all programs, cycles, and sessions for a user while keeping their account:

```bash
# First user in the database
docker-compose exec app pnpm db:reset-user

# Specific user by email
USER_EMAIL=someone@example.com docker-compose exec app pnpm db:reset-user
```

---

## Seeding fake data (development)

Populates the first user (or a specific user) with two programs, a 12-week training cycle, and 4 weeks of workout history:

```bash
docker-compose exec app pnpm db:seed-fake

# Specific user
USER_EMAIL=someone@example.com docker-compose exec app pnpm db:seed-fake

# Wipe existing data first
docker-compose exec app pnpm db:seed-fake --force
```

---

## Security notes

- Passwords are hashed by Better Auth (bcrypt) — they are never stored in plain text
- Sessions are stored in the `session` table and validated server-side on every request
- Middleware performs a fast cookie-presence check at the edge; Server Components call `requireSession()` for full cryptographic verification
- Mutation Server Actions resolve `userId` from the session internally — clients cannot pass a user ID to act on behalf of another user
- Admins cannot delete their own account via the UI to prevent accidental lockout
