import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Composer from "@/components/composer/Composer";

function ControlledComposer() {
  const [value, setValue] = useState("");
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={() => setValue("")}
      placeholder="Message"
      variant="card"
    />
  );
}

describe("Composer", () => {
  it("collapses the textarea back to its default height after send", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.value.length > 0 ? 140 : 48;
      },
    });

    try {
      const user = userEvent.setup();
      render(<ControlledComposer />);

      const textarea = screen.getByLabelText("Message body") as HTMLTextAreaElement;
      await user.type(textarea, "line one{shift>}{enter}{/shift}line two");

      expect(textarea.style.height).toBe("140px");

      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(textarea).toHaveValue("");
        expect(textarea.style.height).toBe("");
      });
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });
});
