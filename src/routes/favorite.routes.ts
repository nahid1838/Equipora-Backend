import { Router } from "express";
import { addFavorite, listFavorites, removeFavorite } from "../controllers/favorite.controller.js";
import { verifyRenter, verifyToken } from "../middlewares/auth.js";

const router = Router();

router.use(verifyToken, verifyRenter);
router.get("/", listFavorites);
router.post("/", addFavorite);
router.delete("/:equipmentId", removeFavorite);

export default router;
