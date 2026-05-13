# MediaVision

AI-powered analytics chat for Nordic TV & streaming data.

## Setup

### 1. Configure environment

Copy `.env.example` to `.env` and fill in:

```
API_KEY=sk-ant-...
DATABASE_URL=postgresql://...
LLM_BACKEND=claude
```

### 2. Install dependencies

```bash
# Node backend
cd node
npm install

# Frontend
cd frontend
npm install
```

### 3. Add users

Before starting, create at least one user account:

```bash
node node/addUser.js <username> <password>
```

Example:

```bash
node node/addUser.js alice secret123
```

### 4. Start

```bash
# Backend (from project root)
cd node && npm run dev

# Frontend (from project root)
cd frontend && npm run dev
```

Open http://localhost:5173 and sign in with the credentials you created.

## Browser Settings (localStorage)

Some features are hidden by default and controlled via browser storage. To toggle them, open the browser console (`F12` → Console tab) and run the commands below, then **refresh the page**.

| Feature        | Enable                                          | Disable                                          |
| -------------- | ----------------------------------------------- | ------------------------------------------------ |
| Eval sidebar   | `localStorage.setItem('enableSidebar', '1')`    | `localStorage.removeItem('enableSidebar')`       |
| Admin mode     | `localStorage.setItem('isAdmin', '1')`          | `localStorage.removeItem('isAdmin')`             |
| Debug panel    | `localStorage.setItem('enableDebug', '1')`      | `localStorage.removeItem('enableDebug')`         |

> **Note:** The debug toggle is also available as a button inside each chat message when `isAdmin` is set.
