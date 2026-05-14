import { Route, Switch } from "wouter";
import GROOVAApp from "./pages/index";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={GROOVAApp} />
    </Switch>
  );
}
