import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import filesRouter from "./files";

const router: IRouter = Router();

router.use(healthRouter);
router.use(filesRouter);
router.use(proxyRouter);

export default router;
