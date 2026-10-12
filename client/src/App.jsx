import {
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
  const messages = new Map(current.map((message) => [message.messageId, message]));
  incoming.forEach((message) => messages.set(message.messageId, message));
  return [...messages.values()].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );
};
const btn =
    "rounded-full bg-amber-500 px-4 py-2 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50",
  card = "rounded-2xl bg-slate-800/70 p-4 border border-amber-500/20",
  inp = "w-full rounded-lg bg-slate-900 border border-slate-600 p-2";
const Auth = createContext();
const useAuth = () => useContext(Auth);
function Provider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setL] = useState(!!localStorage.token);
  const load = useCallback(
    () =>
      api
        .get("/auth/me")
        .then((r) => setUser(r.data))
        .catch(() => setUser(null))
        .finally(() => setL(false)),
    [],
  );
  useEffect(() => {
    if (localStorage.token) load();
  }, [load]);
  const login = (t) => {
      localStorage.token = t;
      setL(true);
      return load();
    },
    logout = () => {
      localStorage.removeItem("token");
      setUser(null);
    };
  return (
    <Auth.Provider value={{ user, loading, login, logout, reload: load }}>
      {children}
    </Auth.Provider>
  );
}
function Private({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8">Loading…</p>;
  return user ? (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  ) : (
    <Navigate to="/login" />
  );
}
function Nav() {
  const { logout, user } = useAuth();
  return (
    <nav className="flex flex-wrap items-center gap-4 border-b border-amber-500/30 bg-slate-950/60 p-3">
      <span className="font-bold text-amber-400">🪘 Dandiya Night</span>
      {[
        ["dashboard", "Discover"],
        ["requests", "Requests"],
        ["matches", "Matches"],
        ["notifications", "Alerts"],
        ["profile", "Profile"],
      ].map(([p, l]) => (
        <Link key={p} to={"/" + p} className="hover:text-amber-300">
          {l}
        </Link>
      ))}
      <button onClick={logout} className="ml-auto text-sm text-slate-300">
        Logout ({user.name})
      </button>
    </nav>
  );
}
const Avatar = ({ u }) => (
  <img
    src={u.photoUrl}
    alt=""
    className="h-20 w-20 rounded-full object-cover border-2 border-amber-500"
  />
);
const Info = ({ u }) => (
  <div>
    <b>{u.name}</b>
    <div className="text-sm text-slate-300">
      {u.course} · Year {u.year} · Age {u.age}
    </div>
    {u.bio && <div className="text-sm italic">{u.bio}</div>}
  </div>
);
function Form({ title, children }) {
  return (
    <div className="mx-auto max-w-md p-4">
      <div className={card}>
        <h1 className="mb-3 text-2xl font-bold text-amber-400">{title}</h1>
        {children}
      </div>
    </div>
  );
}
function Home() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" />;
  return (
    <div className="p-10 text-center">
      <h1 className="text-4xl font-bold text-amber-400">
        🪘 Dandiya Night Partner Portal
      </h1>
      <p className="my-4">Find your Dandiya partner at college.</p>
      <Link className={btn} to="/register">
        Register
      </Link>{" "}
      <Link className={btn} to="/login">
        Login
      </Link>
    </div>
  );
}
function Login() {
  const { login } = useAuth(),
    [f, setF] = useState({ email: "", password: "" }),
    [e, setE] = useState(""),
    [ok, setOk] = useState(false);
  const go = async (x) => {
    x.preventDefault();
    try {
      const r = await api.post("/auth/login", f);
      await login(r.data.token);
      setOk(true);
    } catch (z) {
      setE(err(z));
    }
  };
  if (ok) return <Navigate to="/dashboard" />;
  return (
    <Form title="Login">
      <form onSubmit={go} className="space-y-3">
        <input
          className={inp}
          placeholder="Email"
          type="email"
          required
          onChange={(x) => setF({ ...f, email: x.target.value })}
        />
        <input
          className={inp}
          placeholder="Password"
          type="password"
          required
          onChange={(x) => setF({ ...f, password: x.target.value })}
        />
        {e && <p className="text-red-400">{e}</p>}
        <button className={btn}>Login</button>{" "}
        <Link to="/register" className="text-sm underline">
          Create account
        </Link>
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
    if (!photo) return setE("Profile photo required");
    setB(true);
    const d = new FormData();
    Object.entries(f).forEach(([k, v]) => d.append(k, v));
    d.append("photo", photo);
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
      <form onSubmit={go} className="space-y-3">
        <input
          className={inp}
          type="email"
          placeholder="Email"
          required
          onChange={set("email")}
        />
        <input
          className={inp}
          placeholder="Full name"
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
            Course
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
          placeholder="Age"
          required
          onChange={set("age")}
        />
        <input
          className={inp}
          placeholder="Mobile number"
          required
          onChange={set("mobile")}
        />
        <select className={inp} value={f.gender} onChange={set("gender")}>
          <option>Female</option>
          <option>Male</option>
        </select>
        <input
          className={inp}
          type="password"
          placeholder="Password"
          required
          onChange={set("password")}
        />
        <input
          className={inp}
          type="password"
          placeholder="Confirm password"
          required
          onChange={set("confirmPassword")}
        />
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(x) => setP(x.target.files[0])}
        />
        {e && <p className="text-red-400">{e}</p>}
        <button disabled={busy} className={btn}>
          {busy ? "Creating…" : "Register"}
        </button>
      </form>
    </Form>
  );
}
function Dashboard() {
  const courses = useCourses(),
    [fl, setFl] = useState({ q: "", course: "", year: "" }),
    [l, setL] = useState(null),
    [sent, setS] = useState({}),
    [e, setE] = useState("");
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
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
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
      {e && <p className="text-red-400">{e}</p>}
      {!l ? (
        <p>Loading…</p>
      ) : !l.length ? (
        <p>No active partners found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {l.map((u) => (
            <div key={u.userId} className={card + " flex gap-3"}>
              <Avatar u={u} />
              <div className="flex-1">
                <Info u={u} />
                <span className="text-xs text-green-400">● Active</span>
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
function Chat() {
  const { matchId } = useParams(),
    { user } = useAuth(),
    [msgs, setM] = useState([]),
    [t, setT] = useState(""),
    [st, setSt] = useState("loading"),
    [loadError, setLoadError] = useState(""),
    [busy, setB] = useState(false),
    end = useRef();
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
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);
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
        {!msgs.length && <p className="text-slate-400">Say hello! 👋</p>}
        {msgs.map((m) => (
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
    [msg, setMsg] = useState("");
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
          value={p.age}
          onChange={set("age")}
        />
        <input className={inp} value={p.mobile} onChange={set("mobile")} />
        <textarea
          className={inp}
          placeholder="Short bio"
          maxLength={200}
          value={p.bio}
          onChange={set("bio")}
        />
        <button className={btn}>Save</button> <span>{msg}</span>
      </form>
    </div>
  );
}
export default function App() {
  const P = (C) => (
    <Private>
      <C />
    </Private>
  );
  return (
    <BrowserRouter>
      <Provider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={P(Dashboard)} />
          <Route path="/requests" element={P(Requests)} />
          <Route path="/matches" element={P(Matches)} />
          <Route path="/chat/:matchId" element={P(Chat)} />
          <Route path="/notifications" element={P(Notifications)} />
          <Route path="/profile" element={P(Profile)} />
          <Route path="/settings" element={<Navigate to="/profile" />} />
        </Routes>
      </Provider>
    </BrowserRouter>
  );
}
