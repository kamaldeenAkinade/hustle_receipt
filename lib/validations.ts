import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().email("Invalid email address").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").max(254),
  password: z.string().min(1, "Password is required").max(72),
});

export const tipSchema = z.object({
  slug: z.string().min(1),
  name: z.string().max(80).optional(),
  email: z.string().email("Enter a valid email address").max(254),
  amount: z.coerce
    .number()
    .int("Amount must be a whole number")
    .min(100, "Minimum tip is ₦100")
    .max(10_000_000, "Amount too large"),
  message: z.string().max(500, "Message must be under 500 characters").optional(),
  // Card details (Flutterwave v4 Direct Charge)
  cardNumber: z
    .string()
    .min(12, "Invalid card number")
    .max(19, "Invalid card number"),
  expiryMonth: z
    .string()
    .regex(/^(0[1-9]|1[0-2])$/, "Invalid month — use MM format (01–12)"),
  expiryYear: z
    .string()
    .regex(/^\d{2,4}$/, "Invalid year — use YY format (e.g. 32)"),
  cvv: z.string().regex(/^\d{3,4}$/, "Invalid CVV"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TipInput = z.infer<typeof tipSchema>;
