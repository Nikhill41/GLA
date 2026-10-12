import {
  Component,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useParams,
  useNavigate,
  useLocation,
} from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || "") + "/api",
});
api.interceptors.request.use((c) => {
  if (localStorage.token)
    c.headers.Authorization = "Bearer " + localStorage.token;
  return c;
});
api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && localStorage.token) {
      localStorage.removeItem("token");
      location = "/login";
    }
    return Promise.reject(e);
  },
);
const err = (e) => e.response?.data?.message || e.message;
const mergeMessages = (current, incoming) => {
  const messages = Object.create(null);
  const add = (value) => {
    if (!Array.isArray(value)) return;
    for (const message of value) {
      if (
        message &&
        typeof message === "object" &&
        typeof message.messageId === "string" &&
        typeof message.message === "string"
      ) {
        messages[message.messageId] = {
          ...message,
          createdAt:
            typeof message.createdAt === "string"
              ? message.createdAt
              : new Date().toISOString(),
        };
      }
    }
  };
  add(current);
  add(incoming);
  const result = [];
  for (const messageId of Object.keys(messages)) {
    result.push(messages[messageId]);
  }
  result.sort((a, b) => {
    const first = Date.parse(a.createdAt);
    const second = Date.parse(b.createdAt);
    return (Number.isNaN(first) ? 0 : first) - (Number.isNaN(second) ? 0 : second);
  });
  return result;
};
class AppErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Chat render error", error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="p-8 text-red-300">
          Chat temporarily failed to render. Please try opening the chat again.
          <button
            className={btn + " ml-3"}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    return this.props.children;
  }
}
const btn =
    "rounded-full bg-amber-500 px-4 py-2 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50 transition shadow-sm",
  card = "rounded-2xl bg-slate-800/80 p-5 border border-amber-500/20 shadow-lg",
  inp = "w-full rounded-lg bg-slate-900/90 border border-slate-600 p-2.5 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 transition";
const Auth = createContext();
const useAuth = () => useContext(Auth);
function Provider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setL] = useState(!!localStorage.token);
  const load = useCallback(
    () =>
      api
        .get("/auth/me")
        .then((r) => {
          setUser(r.data);
          return r.data;
        })
        .catch(() => {
          setUser(null);
          return null;
        })
        .finally(() => setL(false)),
    [],
  );
  useEffect(() => {
    if (localStorage.token) load();
  }, [load]);
  const login = async (t) => {
      localStorage.token = t;
      setL(true);
      return await load();
    },
    logout = () => {
      api
        .post("/auth/logout")
        .catch(() => undefined)
        .finally(() => {
          localStorage.removeItem("token");
          setUser(null);
          window.location.href = "/login";
        });
    };
  return (
    <Auth.Provider value={{ user, loading, login, logout, reload: load }}>
      {children}
    </Auth.Provider>
  );
}
function StudentRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.isAdmin) return <Navigate to="/admin" replace />;
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-400">Loading admin portal…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </>
  );
}
function Nav() {
  const { logout, user } = useAuth(),
    { pathname } = useLocation(),
    [counts, setCounts] = useState({
      requests: 0,
      matches: 0,
      notifications: 0,
    });
  const seenKey = (type) => `nav-seen-${type}-${user?.userId || ""}`;
  const getSeen = (type) => {
    try {
      const value = JSON.parse(localStorage.getItem(seenKey(type)) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  };
  const loadCounts = useCallback(async () => {
    if (!user || user.isAdmin) return;
    const [received, matches, notifications] = await Promise.all([
      api.get("/requests/received"),
      api.get("/matches"),
      api.get("/notifications"),
    ]);
    const data = {
      requests: received.data.filter((x) => x.status === "PENDING"),
      matches: matches.data,
      notifications: notifications.data.filter((x) => !x.read),
    };
    setCounts({
      requests: data.requests.filter((x) => !getSeen("requests").has(x.requestId)).length,
      matches: data.matches.filter((x) => !getSeen("matches").has(x.matchId)).length,
      notifications: data.notifications.filter(
        (x) => !getSeen("notifications").has(x.notificationId),
      ).length,
    });
    const currentType =
      pathname === "/requests"
        ? "requests"
        : pathname === "/matches"
          ? "matches"
          : pathname === "/notifications"
            ? "notifications"
            : null;
    if (currentType) {
      const ids = data[currentType].map((x) =>
        currentType === "requests"
          ? x.requestId
          : currentType === "matches"
            ? x.matchId
            : x.notificationId,
      );
      const seen = getSeen(currentType);
      ids.forEach((value) => seen.add(value));
      localStorage.setItem(seenKey(currentType), JSON.stringify([...seen]));
      setCounts((current) => ({ ...current, [currentType]: 0 }));
    }
  }, [pathname, user]);
  useEffect(() => {
    if (!user || user.isAdmin) return;
    loadCounts().catch(() => undefined);
    const timer = setInterval(() => loadCounts().catch(() => undefined), 30000);
    return () => clearInterval(timer);
  }, [loadCounts, user]);
  if (!user) return null;

  if (user.isAdmin) {
    return (
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-slate-950/80 px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="flex items-center gap-2 font-bold text-amber-400 transition hover:text-amber-300"
          >
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
            <span className="text-lg">GLA Dandiya Partner</span>
          </Link>
          <span className="rounded-full border border-amber-500/50 bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            🛡️ GLA Dandiya Partner Admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-400 sm:inline">
            Admin: <span className="font-semibold text-slate-200">{user.email}</span>
          </span>
          <button
            onClick={logout}
            className="rounded-full border border-red-500/50 px-3.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500 hover:text-white"
          >
            Logout
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-slate-950/60 p-3">
      <Link
        to="/dashboard"
        className="mr-2 flex items-center gap-2 font-bold text-amber-400 transition hover:text-amber-300"
      >
        <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
        <span>GLA Dandiya Partner</span>
      </Link>
      {[
        ["requests", "Requests", counts.requests],
        ["matches", "Matches", counts.matches],
        ["chat", "Chat", 0],
        ["notifications", "Alerts", counts.notifications],
        ["profile", "Profile", 0],
      ].map(([p, l]) => (
        <Link
          key={p}
          to={"/" + p}
          className="relative flex items-center gap-1 hover:text-amber-300"
        >
          {l}
          {p !== "chat" && p !== "profile" && counts[p] > 0 && (
            <span className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
              {counts[p] > 99 ? "99+" : counts[p]}
            </span>
          )}
        </Link>
      ))}
      <button
        onClick={logout}
        className="ml-auto rounded-full border border-amber-500/60 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950"
      >
        Logout
      </button>
    </nav>
  );
}
const Avatar = ({ u, size = "h-16 w-16" }) =>
  u?.photoUrl ? (
    <img
      src={u.photoUrl}
      alt={u?.name || "User"}
      className={`${size} rounded-full object-cover border-2 border-amber-500 flex-shrink-0`}
    />
  ) : (
    <div
      className={`${size} rounded-full bg-slate-700 border-2 border-amber-500/50 flex items-center justify-center font-bold text-amber-400 text-lg flex-shrink-0`}
    >
      {(u?.name || "?").charAt(0).toUpperCase()}
    </div>
  );
const Info = ({ u }) => (
  <div>
    <b>{u.name}</b>
    <div className="text-sm text-slate-300">
      {u.course} · Year {u.year} · Age {u.age}
    </div>
    {u.bio && <div className="text-sm italic text-slate-400">{u.bio}</div>}
  </div>
);
function ProfilePreview({ user, onClose }) {
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${user.name} profile`}
      >
        <button
          className="absolute right-4 top-4 rounded-full bg-slate-950/80 px-3 py-1 text-xl text-slate-300 hover:text-white"
          onClick={onClose}
          aria-label="Close profile"
        >
          ×
        </button>
        {user.photoUrl ? (
          <img
            src={user.photoUrl}
            alt={`${user.name} profile`}
            className="mx-auto max-h-[60vh] w-full rounded-2xl object-contain"
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl bg-slate-800 text-6xl font-bold text-amber-400">
            {user.name?.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-white">{user.name}</h2>
            <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-300">
              Active partner
            </span>
          </div>
          <p className="mt-2 text-slate-300">
            {user.course} · Year {user.year} · Age {user.age}
          </p>
          {user.bio && <p className="mt-3 italic text-slate-400">{user.bio}</p>}
          <p className="mt-4 text-xs text-slate-500">
            Contact details are private and are not displayed.
          </p>
        </div>
      </div>
    </div>
  );
}
function AuthNav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-amber-500/20 bg-slate-950/90 px-4 py-3 shadow-lg backdrop-blur-xl">
      <Link
        to="/"
        className="mx-auto flex max-w-6xl items-center gap-3 font-bold text-amber-400 transition hover:text-amber-300"
      >
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl object-cover ring-1 ring-amber-400/50" />
        <span className="text-lg tracking-tight">GLA Dandiya Partner</span>
        <span className="hidden rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-slate-400 sm:inline">
          Partner portal
        </span>
      </Link>
    </nav>
  );
}
function AuthIntro({ title }) {
  return (
    <section className="relative flex min-h-[30rem] flex-col justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl shadow-slate-950/30 backdrop-blur-xl lg:p-10">
      <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-400/15 blur-3xl" />
      <div className="relative">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
          Your festival connection starts here
        </div>
        <img src="/logo.png" alt="GLA Dandiya Partner" className="mb-5 h-20 w-20 rounded-2xl object-cover shadow-lg ring-4 ring-amber-400/10" />
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-400">
          GLA Dandiya Partner
        </p>
        <h2 className="mt-2 max-w-lg text-4xl font-black leading-[1.08] tracking-tight text-white">
        Find your perfect festival partner
        </h2>
        <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
        Connect with college students, discover compatible partners, and make
        your Dandiya celebration memorable.
        </p>
      <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        {[
          ["01", "Discover", "Find active partners by course and year"],
          ["02", "Connect", "Send requests and build genuine connections"],
          ["03", "Chat", "Talk privately after matching"],
        ].map(([number, label, feature]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/25 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <span className="text-xs text-slate-500">{number}</span>
              {label}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">{feature}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-xs text-slate-500">
        Built for memorable campus nights
      </p>
      </div>
    </section>
  );
}
function Form({ title, children }) {
  return (
    <>
      <AuthNav />
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-2 lg:p-10">
        <AuthIntro title={title} />
        <div className="flex items-start justify-center">
          <div className="w-full max-w-xl">
            <div className={card + " border-white/10 bg-slate-800/80 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur-xl"}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                {title === "Login" ? "Welcome back" : "Join the community"}
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">{title}</h1>
              <p className="mb-5 mt-2 text-sm text-slate-400">
                {title === "Login"
                  ? "Continue your GLA Dandiya Partner journey."
                  : "Create your profile and start connecting."}
              </p>
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function Home() {
  const { user } = useAuth();
  if (user) return <Navigate to={user.isAdmin ? "/admin" : "/dashboard"} replace />;
  return (
    <div className="p-10 text-center">
      <h1 className="text-4xl font-bold text-amber-400">
        🪘 GLA Dandiya Partner
      </h1>
      <p className="my-4 text-slate-300">Find your Dandiya partner at college.</p>
      <div className="space-x-3">
        <Link className={btn} to="/register">
          Register
        </Link>
        <Link className={btn} to="/login">
          Login
        </Link>
      </div>
    </div>
  );
}
function Login() {
  const { login, user } = useAuth(),
    navigate = useNavigate(),
    [f, setF] = useState({ email: "", password: "" }),
    [e, setE] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(user.isAdmin ? "/admin" : "/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const go = async (x) => {
    x.preventDefault();
    setE("");
    setBusy(true);
    try {
      const r = await api.post("/auth/login", f);
      const loggedIn = await login(r.data.token);
      if (loggedIn?.isAdmin) {
        navigate("/admin", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (z) {
      setE(err(z));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form title="Login">
      <form onSubmit={go} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
            Email address
          </label>
          <input
            className={inp}
            placeholder="Email"
            type="email"
            required
            value={f.email}
            onChange={(x) => setF({ ...f, email: x.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
            Password
          </label>
          <input
            className={inp}
            placeholder="Enter password"
            type="password"
            required
            value={f.password}
            onChange={(x) => setF({ ...f, password: x.target.value })}
          />
        </div>
        {e && <p className="text-sm text-red-400 bg-red-950/40 p-2.5 rounded-lg border border-red-500/30">{e}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button disabled={busy} className={btn}>
            {busy ? "Signing in…" : "Login"}
          </button>
          <Link to="/register" className="text-sm underline text-slate-300 hover:text-amber-300">
            Create student account
          </Link>
        </div>
      </form>
    </Form>
  );
}
const useCourses = () => {
  const [c, setC] = useState([]);
  useEffect(() => {
    api.get("/config/courses").then((r) => setC(r.data));
  }, []);
  return c;
};
function Register() {
  const courses = useCourses(),
    { login } = useAuth(),
    [f, setF] = useState({ gender: "Female" }),
    [photo, setP] = useState(),
    [e, setE] = useState(""),
    [ok, setOk] = useState(false),
    [busy, setB] = useState(false);
  const set = (k) => (x) =>
      setF({
        ...f,
        [k]: x.target.value,
        ...(k === "course" ? { year: "" } : {}),
      }),
    years = courses.find((c) => c.name === f.course)?.years || [];
  const go = async (x) => {
    x.preventDefault();
    setE("");
    setB(true);
    const d = new FormData();
    Object.entries(f).forEach(([k, v]) => d.append(k, v));
    if (photo) d.append("photo", photo);
    try {
      const r = await api.post("/auth/register", d);
      await login(r.data.token);
      setOk(true);
    } catch (z) {
      setE(err(z));
    }
    setB(false);
  };
  if (ok) return <Navigate to="/dashboard" />;
  return (
    <Form title="Register">
      <form onSubmit={go} className="grid gap-3 sm:grid-cols-2">
        <p className="text-xs text-slate-400 sm:col-span-2">
          Details marked with * are compulsory.
        </p>
        <input
          className={inp + " sm:col-span-2"}
          type="email"
          placeholder="Email *"
          required
          onChange={set("email")}
        />
        <input
          className={inp + " sm:col-span-2"}
          placeholder="Full name *"
          required
          onChange={set("name")}
        />
        <select
          className={inp}
          required
          onChange={set("course")}
          defaultValue=""
        >
          <option value="" disabled>
            Course *
          </option>
          {courses.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          className={inp}
          required
          value={f.year || ""}
          onChange={set("year")}
        >
          <option value="" disabled>
            Year *
          </option>
          {years.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <input
          className={inp}
          type="number"
          min="16"
          max="39"
          placeholder="Age (16–39) *"
          required
          onChange={set("age")}
        />
        <input
          className={inp}
          type="tel"
          placeholder="Mobile number (optional)"
          onChange={set("mobile")}
        />
        <label className="text-sm text-slate-300">
          Gender *
          <select className={inp + " mt-1"} value={f.gender} onChange={set("gender")}>
            <option>Female</option>
            <option>Male</option>
          </select>
        </label>
        <input
          className={inp}
          type="password"
          placeholder="Password *"
          required
          onChange={set("password")}
        />
        <input
          className={inp + " sm:col-span-2"}
          type="password"
          placeholder="Confirm password *"
          required
          onChange={set("confirmPassword")}
        />
        <label className="block cursor-pointer rounded-lg border border-dashed border-amber-500/70 bg-slate-900/70 p-4 text-center transition hover:bg-slate-900 sm:col-span-2">
          <span className="font-semibold text-amber-300">
            {photo ? photo.name : "Upload profile photo (optional)"}
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            JPG, PNG or WEBP · maximum 3MB
          </span>
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(x) => setP(x.target.files[0])}
          />
        </label>
        {e && <p className="text-red-400 sm:col-span-2">{e}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 sm:col-span-2">
          <button disabled={busy} className={btn}>
            {busy ? "Creating…" : "Register"}
          </button>
          <Link to="/login" className="text-sm underline text-slate-300 hover:text-amber-300">
            Already registered? Login
          </Link>
        </div>
      </form>
    </Form>
  );
}
function Dashboard() {
  const courses = useCourses(),
    [fl, setFl] = useState({ q: "", course: "", year: "" }),
    [l, setL] = useState(null),
    [sent, setS] = useState({}),
    [e, setE] = useState(""),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api
          .get("/users/search", { params: fl })
          .then((r) => setL(r.data))
          .catch((z) => setE(err(z))),
      250,
    );
    return () => clearTimeout(t);
  }, [fl]);
  const send = async (u) => {
    try {
      await api.post("/requests", { receiverId: u.userId });
      setS((s) => ({ ...s, [u.userId]: 1 }));
    } catch (z) {
      alert(err(z));
    }
  };
  const yrs = fl.course
    ? courses.find((c) => c.name === fl.course)?.years
    : [1, 2, 3, 4, 5];
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-800 to-slate-900 p-6 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
          Discover
        </p>
        <h1 className="mt-1 text-3xl font-bold text-white">
          Find your Dandiya partner
        </h1>
        <p className="mt-2 max-w-2xl text-slate-300">
          Browse active students and send a request to your perfect festival
          partner.
        </p>
      </section>
      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-amber-300">Search partners</h2>
          <span className="text-sm text-slate-400">Age 16–39</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
        <input
          className={inp}
          placeholder="Search by name"
          onChange={(x) => setFl({ ...fl, q: x.target.value })}
        />
        <select
          className={inp}
          onChange={(x) => setFl({ ...fl, course: x.target.value, year: "" })}
        >
          <option value="">All Courses</option>
          {courses.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          className={inp}
          value={fl.year}
          onChange={(x) => setFl({ ...fl, year: x.target.value })}
        >
          <option value="">All Years</option>
          {(yrs || []).map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        </div>
      </section>
      {e && <p className="text-red-400">{e}</p>}
      {!l ? (
        <p>Loading…</p>
      ) : !l.length ? (
        <p>No active partners found.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {l.map((u) => (
            <div key={u.userId} className={card + " flex min-h-40 gap-4 shadow-lg"}>
              <button
                className="h-fit rounded-full text-left focus:outline-none focus:ring-2 focus:ring-amber-400"
                onClick={() => setSelected(u)}
                aria-label={`View ${u.name}'s profile photo`}
              >
                <Avatar u={u} size="h-24 w-24" />
              </button>
              <div className="flex-1">
                <Info u={u} />
                <span className="text-xs text-green-400">● Active</span>
                <button
                  className="ml-3 text-xs text-amber-300 underline hover:text-amber-200"
                  onClick={() => setSelected(u)}
                >
                  View profile
                </button>
                <div className="mt-2">
                  <button
                    disabled={sent[u.userId]}
                    className={btn}
                    onClick={() => send(u)}
                  >
                    {sent[u.userId] ? "Request sent" : "Send Request"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <ProfilePreview user={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function Requests() {
  const [r, setR] = useState([]),
    [s, setS] = useState([]),
    load = () => {
      api.get("/requests/received").then((x) => setR(x.data));
      api.get("/requests/sent").then((x) => setS(x.data));
    };
  useEffect(load, []);
  const act = async (id, a) => {
    try {
      await api.put(`/requests/${id}/${a}`);
      load();
    } catch (z) {
      alert(err(z));
      load();
    }
  };
  const Row = ({ x, children }) => (
    <div className={card + " flex items-center gap-3"}>
      <Avatar u={x.user} />
      <div className="flex-1">
        <Info u={x.user} />
      </div>
      {children}
    </div>
  );
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold text-amber-400">Received Requests</h2>
      {!r.length && <p>None yet.</p>}
      {r.map((x) => (
        <Row key={x.requestId} x={x}>
          {x.status === "PENDING" ? (
            <div className="space-x-2">
              <button
                className={btn}
                onClick={() => act(x.requestId, "accept")}
              >
                Accept
              </button>
              <button
                className="rounded-full border px-4 py-2"
                onClick={() => act(x.requestId, "reject")}
              >
                Reject
              </button>
            </div>
          ) : (
            <b>{x.status}</b>
          )}
        </Row>
      ))}
      <h2 className="text-xl font-bold text-amber-400">Sent Requests</h2>
      {!s.length && <p>None yet.</p>}
      {s.map((x) => (
        <Row key={x.requestId} x={x}>
          <b>{x.status}</b>
          {x.status === "PENDING" && (
            <button
              className="ml-2 text-sm underline"
              onClick={async () => {
                await api.delete("/requests/" + x.requestId);
                load();
              }}
            >
              Cancel
            </button>
          )}
        </Row>
      ))}
    </div>
  );
}
function Matches() {
  const [l, setL] = useState(null),
    load = () => api.get("/matches").then((r) => setL(r.data));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold text-amber-400">My Matches</h2>
      {!l ? <p>Loading…</p> : !l.length && <p>No matches yet.</p>}
      {l?.map((m) => (
        <div key={m.matchId} className={card + " flex items-center gap-3"}>
          <Avatar u={m.user} />
          <div className="flex-1">
            <Info u={m.user} />
          </div>
          <Link className={btn} to={"/chat/" + m.matchId}>
            Open Chat
          </Link>
          <button
            className="text-sm underline"
            onClick={async () => {
              if (confirm("Unmatch? Chat will close.")) {
                await api.put(`/matches/${m.matchId}/unmatch`);
                load();
              }
            }}
          >
            Unmatch
          </button>
        </div>
      ))}
    </div>
  );
}
function ChatTab() {
  const [matches, setMatches] = useState(null),
    [error, setError] = useState("");

  const load = () => {
    setError("");
    return api
      .get("/matches")
      .then((r) => setMatches(r.data))
      .catch((e) => setError(err(e)));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-amber-400">Chat</h2>
        <p className="text-sm text-slate-400">
          Chat is available only while a match is active.
        </p>
      </div>
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline">
            Try again
          </button>
        </div>
      )}
      {!matches && !error && <p>Loading active matches…</p>}
      {matches && !matches.length && (
        <div className={card}>
          <p className="text-slate-300">No active matches yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Chat will appear here after a request is accepted.
          </p>
        </div>
      )}
      <div className="space-y-3">
        {matches?.map((match) => (
          <div key={match.matchId} className={card + " flex items-center gap-3"}>
            <Avatar u={match.user} />
            <div className="flex-1">
              <Info u={match.user} />
              <span className="text-xs text-green-400">● Active match</span>
            </div>
            <Link className={btn} to={"/chat/" + match.matchId}>
              Open Chat
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
function Chat() {
  const { matchId } = useParams(),
    { user } = useAuth(),
    [msgs, setM] = useState([]),
    [t, setT] = useState(""),
    [st, setSt] = useState("loading"),
    [loadError, setLoadError] = useState(""),
    [busy, setB] = useState(false),
    end = useRef();
  const visibleMessages = Array.isArray(msgs) ? msgs : [];
  useEffect(() => {
    const s = io(import.meta.env.VITE_API_URL || undefined, {
      auth: { token: localStorage.token },
    });
    const load = () =>
      s.emit("join", matchId, async (a) => {
        if (a?.error) return setSt(a.error);
        try {
          const history = (await api.get("/messages/" + matchId)).data;
          setM((previous) => mergeMessages(previous, history));
          setLoadError("");
          setSt("ok");
        } catch (z) {
          setLoadError(err(z));
          setSt("ok");
        }
      });
    s.on("connect", load);
    s.on("connect_error", (z) => {
      setLoadError(z.message || "Unable to connect to chat");
      setSt("reconnecting");
    });
    s.on("disconnect", () => setSt((x) => (x === "ok" ? "reconnecting" : x)));
    s.on("message", (m) =>
      setM((p) => mergeMessages(p, [m])),
    );
    s.on("unmatched", () => setSt("This match has ended."));
    return () => s.disconnect();
  }, [matchId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);
  const send = async (x) => {
    x.preventDefault();
    if (!t.trim()) return;
    setB(true);
    try {
      const message = (await api.post("/messages", { matchId, message: t })).data;
      setM((previous) => mergeMessages(previous, [message]));
      setT("");
    } catch (z) {
      alert(err(z));
    } finally {
      setB(false);
    }
  };
  if (st === "loading") return <p>Loading chat…</p>;
  return (
    <div className={card}>
      {st === "reconnecting" && <p className="text-amber-300">Reconnecting…</p>}
      {loadError && (
        <p className="mb-2 text-amber-300">{loadError}. New messages will still appear live.</p>
      )}
      {st !== "ok" && st !== "reconnecting" && (
        <p className="text-red-400">{st}</p>
      )}
      <div className="h-[55vh] space-y-2 overflow-y-auto">
        {!visibleMessages.length && <p className="text-slate-400">Say hello! 👋</p>}
        {visibleMessages.map((m) => (
          <div
            key={m.messageId}
            className={
              "flex " + (m.senderId === user.userId ? "justify-end" : "")
            }
          >
            <span
              className={
                "max-w-[75%] rounded-2xl px-3 py-1 " +
                (m.senderId === user.userId
                  ? "bg-amber-500 text-slate-900"
                  : "bg-slate-700")
              }
            >
              {m.message}
            </span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          className={inp}
          value={t}
          maxLength={1000}
          onChange={(x) => setT(x.target.value)}
          placeholder="Type a message"
        />
        <button disabled={busy} className={btn}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
function SafeChat() {
  return (
    <AppErrorBoundary>
      <Chat />
    </AppErrorBoundary>
  );
}
function Admin() {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [actionMsg, setActionMsg] = useState(""),
    [tab, setTab] = useState("overview"),
    [userSearch, setUserSearch] = useState(""),
    [userStatusFilter, setUserStatusFilter] = useState("all"),
    [userGenderFilter, setUserGenderFilter] = useState("all"),
    [msgSearch, setMsgSearch] = useState(""),
    [reqStatusFilter, setReqStatusFilter] = useState("all"),
    [matchStatusFilter, setMatchStatusFilter] = useState("all");

  const load = () => {
    setLoading(true);
    return api
      .get("/admin/overview")
      .then((r) => {
        setData(r.data);
        setError("");
      })
      .catch((e) => setError(err(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const flash = (m) => {
    setActionMsg(m);
    setTimeout(() => setActionMsg(""), 4000);
  };

  const remove = async (path, label) => {
    if (!confirm(`Are you sure you want to delete this ${label}? This cannot be undone.`)) return;
    try {
      await api.delete(path);
      flash(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted successfully.`);
      await load();
    } catch (e) {
      setError(err(e));
    }
  };

  const toggleUserStatus = async (targetUser) => {
    try {
      await api.put(`/admin/users/${targetUser.userId}/status`, {
        isActive: !targetUser.isActive,
      });
      flash(`User "${targetUser.name}" marked ${!targetUser.isActive ? "Active" : "Inactive"}.`);
      await load();
    } catch (e) {
      setError(err(e));
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center">
        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent"></div>
        <p className="text-lg font-semibold text-amber-300">Loading Admin Dashboard…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-6 text-center">
        <p className="mb-3 text-lg font-semibold text-red-300">{error}</p>
        <button onClick={load} className={btn}>Try Again</button>
      </div>
    );
  }

  const userMap = new Map((data?.users || []).map((u) => [u.userId, u]));
  const getUser = (id) =>
    userMap.get(id) || {
      name: `User (${id ? id.slice(0, 8) : "Unknown"})`,
      userId: id,
      course: "N/A",
      year: "",
    };

  const filteredUsers = (data?.users || []).filter((u) => {
    const q = userSearch.toLowerCase();
    const matchesSearch =
      !q ||
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.mobile || "").toLowerCase().includes(q) ||
      (u.course || "").toLowerCase().includes(q);
    const matchesStatus =
      userStatusFilter === "all" ||
      (userStatusFilter === "active" && u.isActive) ||
      (userStatusFilter === "inactive" && !u.isActive);
    const matchesGender =
      userGenderFilter === "all" || u.gender === userGenderFilter;
    return matchesSearch && matchesStatus && matchesGender;
  });

  const filteredRequests = (data?.requests || []).filter((r) => {
    if (reqStatusFilter === "all") return true;
    return r.status === reqStatusFilter;
  });

  const filteredMatches = (data?.matches || []).filter((m) => {
    if (matchStatusFilter === "all") return true;
    return m.status === matchStatusFilter;
  });

  const filteredMessages = (data?.messages || []).filter((m) => {
    if (!msgSearch) return true;
    const q = msgSearch.toLowerCase();
    const sender = getUser(m.senderId);
    return (
      (m.message || "").toLowerCase().includes(q) ||
      (sender.name || "").toLowerCase().includes(q)
    );
  });

  const statCards = [
    { label: "Total Users", val: data.stats.users, targetTab: "users", icon: "👥" },
    { label: "Active Users", val: data.stats.activeUsers, targetTab: "users", icon: "🟢" },
    { label: "Pending Requests", val: data.stats.pendingRequests, targetTab: "requests", icon: "📩" },
    { label: "Active Matches", val: data.stats.activeMatches, targetTab: "matches", icon: "🤝" },
    { label: "Chat Messages", val: data.stats.messages, targetTab: "messages", icon: "💬" },
    { label: "Notifications", val: data.stats.notifications, targetTab: "notifications", icon: "🔔" },
  ];

  const tabs = [
    { id: "overview", label: "📊 Overview" },
    { id: "users", label: `👥 Users (${data.users.length})` },
    { id: "requests", label: `📩 Requests (${data.requests.length})` },
    { id: "matches", label: `🤝 Matches (${data.matches.length})` },
    { id: "messages", label: `💬 Messages (${data.messages.length})` },
    { id: "notifications", label: `🔔 Alerts (${data.notifications.length})` },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 shadow-xl">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
            Control Center
          </span>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            GLA Dandiya Partner Administration
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            Managing event portal · Logged in as <strong className="text-amber-300">{data.admin.email}</strong>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-full border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500 hover:text-slate-900"
          >
            <span>{loading ? "Refreshing…" : "🔄 Refresh Data"}</span>
          </button>
        </div>
      </div>

      {/* Action / Error Banners */}
      {actionMsg && (
        <div className="rounded-xl border border-green-500/50 bg-green-950/60 p-4 text-green-300 text-sm shadow">
          ✓ {actionMsg}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-500/50 bg-red-950/60 p-4 text-red-300 text-sm shadow">
          ✕ {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((s) => (
          <div
            key={s.label}
            onClick={() => setTab(s.targetTab)}
            className={`${card} cursor-pointer transition hover:scale-105 hover:border-amber-400`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{s.label}</span>
              <span>{s.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-400 sm:text-3xl">{s.val}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? "bg-amber-500 text-slate-950 shadow"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Overview */}
      {tab === "overview" && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Quick Users Summary */}
          <section className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-amber-300">👥 Recently Registered Students</h2>
              <button onClick={() => setTab("users")} className="text-xs text-amber-400 underline">
                View All ({data.users.length})
              </button>
            </div>
            <div className="space-y-3">
              {data.users.slice(0, 5).map((u) => (
                <div key={u.userId} className="flex items-center gap-3 rounded-xl bg-slate-900/60 p-3">
                  <Avatar u={u} size="h-12 w-12" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-semibold text-white">{u.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {u.course} · Year {u.year} · {u.gender}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      u.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
              {!data.users.length && <p className="text-slate-400 text-sm">No registered users yet.</p>}
            </div>
          </section>

          {/* Quick Matches & Requests Summary */}
          <section className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-amber-300">🤝 Recent Matches</h2>
              <button onClick={() => setTab("matches")} className="text-xs text-amber-400 underline">
                View All ({data.matches.length})
              </button>
            </div>
            <div className="space-y-3">
              {data.matches.slice(0, 5).map((m) => {
                const u1 = getUser(m.user1Id);
                const u2 = getUser(m.user2Id);
                return (
                  <div key={m.matchId} className="flex items-center justify-between rounded-xl bg-slate-900/60 p-3">
                    <div className="flex items-center gap-2">
                      <Avatar u={u1} size="h-10 w-10" />
                      <span className="text-xs font-semibold text-slate-200">{u1.name}</span>
                    </div>
                    <span className="text-amber-400 font-bold">❤️</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{u2.name}</span>
                      <Avatar u={u2} size="h-10 w-10" />
                    </div>
                  </div>
                );
              })}
              {!data.matches.length && <p className="text-slate-400 text-sm">No matches created yet.</p>}
            </div>
          </section>
        </div>
      )}

      {/* Tab 2: Users Management */}
      {tab === "users" && (
        <section className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-amber-300">Student Profiles ({filteredUsers.length})</h2>
              <p className="text-xs text-slate-400">Manage registered students, active visibility, and privacy</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inp} w-48 text-sm`}
                placeholder="Search by name, email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              <select
                className={`${inp} w-32 text-sm`}
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <select
                className={`${inp} w-32 text-sm`}
                value={userGenderFilter}
                onChange={(e) => setUserGenderFilter(e.target.value)}
              >
                <option value="all">All Genders</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </div>
          </div>

          {!filteredUsers.length && (
            <p className="py-8 text-center text-slate-400">No users match the search criteria.</p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {filteredUsers.map((u) => (
              <div
                key={u.userId}
                className="flex flex-col justify-between rounded-xl border border-slate-700 bg-slate-900/70 p-4 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <Avatar u={u} size="h-16 w-16" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-base truncate">{u.name}</h3>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 border border-slate-700">
                        {u.gender}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          u.isActive
                            ? "bg-green-500/20 text-green-400 border border-green-500/40"
                            : "bg-red-500/20 text-red-400 border border-red-500/40"
                        }`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-amber-300 font-medium truncate">
                      {u.course} · Year {u.year} · Age {u.age}
                    </p>

                    <div className="mt-2 space-y-0.5 text-xs text-slate-300">
                      <div>
                        ✉️ <a href={`mailto:${u.email}`} className="text-amber-400 hover:underline">{u.email}</a>
                      </div>
                      <div>
                        📞 <a href={`tel:${u.mobile}`} className="text-slate-300 hover:underline">{u.mobile}</a>
                      </div>
                    </div>

                    {u.bio && (
                      <p className="mt-2 text-xs italic text-slate-400 line-clamp-2">
                        "{u.bio}"
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
                  <button
                    onClick={() => toggleUserStatus(u)}
                    className="rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    Set {u.isActive ? "Inactive" : "Active"}
                  </button>
                  <button
                    onClick={() => remove(`/admin/users/${u.userId}`, "user")}
                    className="rounded-lg border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500 hover:text-white transition"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tab 3: Requests Management */}
      {tab === "requests" && (
        <section className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-amber-300">Partner Requests ({filteredRequests.length})</h2>
              <p className="text-xs text-slate-400">View and moderate connection requests between students</p>
            </div>
            <select
              className={`${inp} w-40 text-sm`}
              value={reqStatusFilter}
              onChange={(e) => setReqStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="PENDING">PENDING</option>
              <option value="ACCEPTED">ACCEPTED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>

          {!filteredRequests.length && (
            <p className="py-8 text-center text-slate-400">No requests found.</p>
          )}

          <div className="space-y-3">
            {filteredRequests.map((r) => {
              const sender = getUser(r.senderId);
              const receiver = getUser(r.receiverId);
              const statusColors = {
                PENDING: "bg-amber-500/20 text-amber-300 border-amber-500/40",
                ACCEPTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
                REJECTED: "bg-rose-500/20 text-rose-300 border-rose-500/40",
                CANCELLED: "bg-slate-700 text-slate-300 border-slate-600",
              };

              return (
                <div
                  key={r.requestId}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4"
                >
                  {/* Sender */}
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <Avatar u={sender} size="h-12 w-12" />
                    <div>
                      <p className="font-bold text-white text-sm">{sender.name}</p>
                      <p className="text-xs text-slate-400">{sender.course || "Sender"}</p>
                    </div>
                  </div>

                  {/* Flow & Status */}
                  <div className="flex flex-col items-center">
                    <span className="text-xs text-slate-400">sent request to</span>
                    <span className="text-lg">➡️</span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        statusColors[r.status] || "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>

                  {/* Receiver */}
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <Avatar u={receiver} size="h-12 w-12" />
                    <div>
                      <p className="font-bold text-white text-sm">{receiver.name}</p>
                      <p className="text-xs text-slate-400">{receiver.course || "Receiver"}</p>
                    </div>
                  </div>

                  {/* Date & Actions */}
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => remove(`/admin/requests/${r.requestId}`, "request")}
                      className="rounded border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500 hover:text-white transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Tab 4: Matches Management */}
      {tab === "matches" && (
        <section className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-amber-300">Event Partner Matches ({filteredMatches.length})</h2>
              <p className="text-xs text-slate-400">Active matches and previous match pairings</p>
            </div>
            <select
              className={`${inp} w-40 text-sm`}
              value={matchStatusFilter}
              onChange={(e) => setMatchStatusFilter(e.target.value)}
            >
              <option value="all">All Matches</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="UNMATCHED">UNMATCHED</option>
            </select>
          </div>

          {!filteredMatches.length && (
            <p className="py-8 text-center text-slate-400">No matches found.</p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {filteredMatches.map((m) => {
              const u1 = getUser(m.user1Id);
              const u2 = getUser(m.user2Id);

              return (
                <div
                  key={m.matchId}
                  className="flex flex-col justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                        m.status === "ACTIVE"
                          ? "bg-green-500/20 text-green-300 border-green-500/40"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {m.status === "ACTIVE" ? "🟢 ACTIVE PAIR" : "⚪ UNMATCHED"}
                    </span>
                    <span className="text-xs text-slate-400">
                      Matched: {new Date(m.matchedAt || m.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="my-4 flex items-center justify-around gap-2">
                    <div className="flex flex-col items-center text-center">
                      <Avatar u={u1} size="h-14 w-14" />
                      <p className="mt-1 font-semibold text-white text-sm">{u1.name}</p>
                      <p className="text-xs text-slate-400">{u1.gender} · {u1.course}</p>
                    </div>

                    <div className="text-center">
                      <span className="text-2xl">🪘</span>
                      <p className="text-xs font-semibold text-amber-400">Dandiya Pair</p>
                    </div>

                    <div className="flex flex-col items-center text-center">
                      <Avatar u={u2} size="h-14 w-14" />
                      <p className="mt-1 font-semibold text-white text-sm">{u2.name}</p>
                      <p className="text-xs text-slate-400">{u2.gender} · {u2.course}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                    <code className="text-[10px] text-slate-500 truncate max-w-[200px]">{m.matchId}</code>
                    <button
                      onClick={() => remove(`/admin/matches/${m.matchId}`, "match")}
                      className="rounded border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500 hover:text-white transition"
                    >
                      Delete Match
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Tab 5: Messages Management */}
      {tab === "messages" && (
        <section className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-amber-300">Chat Messages ({filteredMessages.length})</h2>
              <p className="text-xs text-slate-400">Monitor message logs and moderate abusive content</p>
            </div>
            <input
              className={`${inp} w-60 text-sm`}
              placeholder="Search message text or sender..."
              value={msgSearch}
              onChange={(e) => setMsgSearch(e.target.value)}
            />
          </div>

          {!filteredMessages.length && (
            <p className="py-8 text-center text-slate-400">No chat messages found.</p>
          )}

          <div className="space-y-3">
            {filteredMessages.map((msg) => {
              const sender = getUser(msg.senderId);
              const receiver = getUser(msg.receiverId);

              return (
                <div
                  key={`${msg.matchId}-${msg.messageId}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3.5"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-[280px]">
                    <Avatar u={sender} size="h-10 w-10" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{sender.name}</span>
                        <span className="text-xs text-slate-400">➡️ {receiver.name}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(msg.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 rounded-lg bg-slate-800/80 px-3 py-1.5 text-sm text-slate-200 border border-slate-700">
                        {msg.message}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      remove(
                        `/admin/messages/${msg.matchId}/${msg.messageId}`,
                        "message",
                      )
                    }
                    className="rounded border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500 hover:text-white transition"
                  >
                    Delete Message
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Tab 6: Notifications Management */}
      {tab === "notifications" && (
        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-amber-300">System Notifications ({data.notifications.length})</h2>
              <p className="text-xs text-slate-400">Live system push alerts and notices</p>
            </div>
          </div>

          {!data.notifications.length && (
            <p className="py-8 text-center text-slate-400">No system notifications found.</p>
          )}

          <div className="space-y-3">
            {data.notifications.map((n) => {
              const recipient = getUser(n.recipientId);

              return (
                <div
                  key={n.notificationId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <Avatar u={recipient} size="h-10 w-10" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{recipient.name}</span>
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                          {n.type}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            n.read ? "bg-slate-800 text-slate-400" : "bg-blue-500/20 text-blue-300"
                          }`}
                        >
                          {n.read ? "Read" : "Unread"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">{n.message}</p>
                      <p className="text-[10px] text-slate-500">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      remove(
                        `/admin/notifications/${n.recipientId}/${n.notificationId}`,
                        "notification",
                      )
                    }
                    className="rounded border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500 hover:text-white transition"
                  >
                    Delete Alert
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
function Notifications() {
  const [l, setL] = useState([]);
  useEffect(() => {
    api.get("/notifications").then((r) => setL(r.data));
  }, []);
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-bold text-amber-400">Notifications</h2>
      {!l.length && <p>Nothing yet.</p>}
      {l.map((n) => (
        <div
          key={n.notificationId}
          className={card + (n.read ? " opacity-60" : "")}
          onClick={() => {
            api.put(`/notifications/${n.notificationId}/read`);
            setL(l.map((x) => (x === n ? { ...n, read: true } : x)));
          }}
        >
          {n.message}
          <div className="text-xs text-slate-400">
            {n.type} · {new Date(n.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
function Profile() {
  const courses = useCourses(),
    { reload } = useAuth(),
    [p, setP] = useState(null),
    [msg, setMsg] = useState(""),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    api.get("/profile").then((r) => setP(r.data));
  }, []);
  if (!p) return <p>Loading…</p>;
  const set = (k) => (x) =>
      setP({
        ...p,
        [k]: x.target.value,
        ...(k === "course" ? { year: "" } : {}),
      }),
    years = courses.find((c) => c.name === p.course)?.years || [];
  const save = async (x) => {
    x.preventDefault();
    try {
      setP((await api.put("/profile", p)).data);
      setMsg("Saved");
      reload();
    } catch (z) {
      setMsg(err(z));
    }
  };
  const toggle = async () => {
    setP(
      (await api.put("/profile/visibility", { isActive: !p.isActive })).data,
    );
    reload();
  };
  const photo = async (x) => {
    const d = new FormData();
    d.append("photo", x.target.files[0]);
    try {
      setP((await api.post("/profile/photo", d)).data);
      reload();
    } catch (z) {
      setMsg(err(z));
    }
  };
  const deleteAccount = async () => {
    if (
      !confirm(
        "Delete your account permanently? Your profile, requests, matches, messages, notifications, and photo will be removed.",
      )
    )
      return;
    setDeleting(true);
    setMsg("");
    try {
      await api.delete("/profile");
      localStorage.removeItem("token");
      window.location.href = "/login";
    } catch (z) {
      setMsg(err(z));
      setDeleting(false);
    }
  };
  return (
    <div className={card + " space-y-3"}>
      <div className="flex items-center gap-4">
        <Avatar u={p} />
        <input type="file" accept="image/*" onChange={photo} />
      </div>
      <p className="text-sm text-slate-300">
        Email: {p.email} (private) · Gender: {p.gender}
      </p>
      <button className={btn} onClick={toggle}>
        {p.isActive
          ? "Active — click to go Inactive"
          : "Inactive — click to go Active"}
      </button>
      <form onSubmit={save} className="space-y-2">
        <input className={inp} value={p.name} onChange={set("name")} />
        <select className={inp} value={p.course} onChange={set("course")}>
          {courses.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <select className={inp} value={p.year} onChange={set("year")}>
          <option value="" disabled>
            Year
          </option>
          {years.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <input
          className={inp}
          type="number"
          min="16"
          max="39"
          value={p.age}
          onChange={set("age")}
        />
        <input
          className={inp}
          type="tel"
          placeholder="Mobile number (optional)"
          value={p.mobile || ""}
          onChange={set("mobile")}
        />
        <textarea
          className={inp}
          placeholder="Short bio"
          maxLength={200}
          value={p.bio}
          onChange={set("bio")}
        />
        <button className={btn}>Save</button> <span>{msg}</span>
      </form>
      <div className="border-t border-red-500/30 pt-4">
        <h2 className="font-semibold text-red-300">Danger zone</h2>
        <p className="mt-1 text-sm text-slate-400">
          Permanently delete your account and all associated data.
        </p>
        <button
          type="button"
          onClick={deleteAccount}
          disabled={deleting}
          className="mt-3 rounded-full border border-red-500/60 px-4 py-2 font-semibold text-red-300 transition hover:bg-red-500 hover:text-white disabled:opacity-50"
        >
          {deleting ? "Deleting account…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Provider>
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <StudentRoute>
                <Dashboard />
              </StudentRoute>
            }
          />
          <Route
            path="/requests"
            element={
              <StudentRoute>
                <Requests />
              </StudentRoute>
            }
          />
          <Route
            path="/matches"
            element={
              <StudentRoute>
                <Matches />
              </StudentRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <StudentRoute>
                <ChatTab />
              </StudentRoute>
            }
          />
          <Route
            path="/chat/:matchId"
            element={
              <StudentRoute>
                <SafeChat />
              </StudentRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <StudentRoute>
                <Notifications />
              </StudentRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <StudentRoute>
                <Profile />
              </StudentRoute>
            }
          />
          <Route path="/settings" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Provider>
    </BrowserRouter>
  );
}
