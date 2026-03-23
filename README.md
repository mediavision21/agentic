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
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### 3. Add users

Before starting, create at least one user account:

```bash
cd backend
python add_user.py <username> <password>
```

Example:

```bash
python add_user.py alice secret123
```

### 4. Start

```bash
# Backend (from project root)
cd backend && uvicorn main:app --reload

# Frontend (from project root)
cd frontend && npm run dev
```

Open http://localhost:5173 and sign in with the credentials you created.
