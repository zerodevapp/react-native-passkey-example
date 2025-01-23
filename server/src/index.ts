import { Hono } from "hono"
import { jwt } from "hono/jwt"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"

// Simulating a database
const db = new Map<string, string>()

const app = new Hono()

// JWT middleware
const jwtMiddleware = jwt({
    secret: "your-secret-key"
})

// Schemas for request validation
const registerSchema = z.object({
    userId: z.string(),
    publicKey: z.string()
})

const loginSchema = z.object({
    userId: z.string()
})

// Register a new passkey
app.post("/register", zValidator("json", registerSchema), async (c) => {
    const { userId, publicKey } = c.req.valid("json")

    if (db.has(userId)) {
        return c.json({ error: "User already exists" }, 400)
    }

    db.set(userId, publicKey)
    return c.json({ message: "Passkey registered successfully" }, 201)
})

// Login with passkey
app.post("/login", zValidator("json", loginSchema), async (c) => {
    const { userId } = c.req.valid("json")

    if (!db.has(userId)) {
        return c.json({ error: "User not found" }, 404)
    }

    const publicKey = db.get(userId)

    // In a real-world scenario, you would verify the passkey here
    // For this example, we'll just create a JWT token

    const token = await c.jwt.sign({ userId })
    return c.json({ token })
})

// Protected route example
app.get("/protected", jwtMiddleware, async (c) => {
    const payload = c.get("jwtPayload")
    return c.json({ message: `Welcome, user ${payload.userId}!` })
})

export default app
