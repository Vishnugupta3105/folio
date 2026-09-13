import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth/AuthForm";

export default async function LoginPage() {
  if (await currentUser()) redirect("/library");
  return <AuthForm mode="login" />;
}
