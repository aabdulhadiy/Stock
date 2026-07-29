import { redirect } from "next/navigation";

/** The shell has no landing page; the proxy sends signed-out visitors to /login. */
export default function RootPage() {
  redirect("/dashboard");
}
