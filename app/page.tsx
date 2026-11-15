import App from "../components/App";
import snapshot from "../data/snapshot.json";
import type { Snapshot } from "../lib/types";

export default function Page() {
  return <App snap={snapshot as unknown as Snapshot} />;
}
