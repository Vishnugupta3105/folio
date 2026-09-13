import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth/AuthForm";

export default async function SignupPage() {
  if (await currentUser()) redirect("/library");
  return <AuthForm mode="signup" />;
}
