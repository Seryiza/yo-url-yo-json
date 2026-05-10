import * as z from "zod";

export default z.object({
  title: z.string().describe("Main product or page title"),
  price: z.string().describe("Displayed price, including currency when available"),
  description: z.string().describe("Short human-readable summary from the page"),
});
