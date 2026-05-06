import { Navigate } from "react-router-dom";

// Página migrada: agora "Curadores" é uma aba dentro de Playlist Deals.
export default function Curadores() {
  return <Navigate to="/playlist-deals" replace />;
}
