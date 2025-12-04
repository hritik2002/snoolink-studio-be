import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";
const supabase = createClient(CONFIG.supabase.supabaseUrl, CONFIG.supabase.supabaseKey);
export async function authenticateUser(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                error: "Missing or invalid authorization header",
            });
        }
        const token = authHeader.substring(7);
        const { data: { user }, error, } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({
                success: false,
                error: "Invalid or expired token",
            });
        }
        req.user = {
            id: user.id,
            email: user.email,
        };
        next();
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            error: `Authentication failed: ${error.message}`,
        });
    }
}
export async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.substring(7);
            const { data: { user }, } = await supabase.auth.getUser(token);
            if (user) {
                req.user = {
                    id: user.id,
                    email: user.email,
                };
            }
        }
        next();
    }
    catch (error) {
        next();
    }
}
