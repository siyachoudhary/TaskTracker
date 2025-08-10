import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const base = "http://localhost:4000";

export default function Auth() {
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch(`${base}/me`, {
          credentials: "include",
        });
        if (res.ok) {
          navigate("/orgs");
        }
      } catch (err) {
        console.error("Auth check failed", err);
      }
    }
    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="card w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-2">Welcome to TaskTracker</h1>
        <p className="text-slate-600 mb-6">Sign in to continue</p>
        <div className="space-y-3">
          <a
            className="btn w-full justify-center"
            href={`${base}/auth/google/start`}
          >
            Continue with Google
          </a>
          {/* Microsoft intentionally hidden per current scope */}
          {/* <a
            className="btn-outline w-full justify-center"
            href="/orgs"
          >
            Skip to app (requires cookie from login)
          </a> */}
        </div>
      </div>
    </div>
  );
}
