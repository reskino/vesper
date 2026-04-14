import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import filesRouter from "./files";
import portProxyRouter from "./port-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(filesRouter);
router.use(portProxyRouter);
router.use(proxyRouter);

export default router;
