
document.addEventListener("DOMContentLoaded", () => {
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");

  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("nav-open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
  }

  const variantSelect = document.getElementById("variant_id");
  if (variantSelect) {
    const price = document.getElementById("chosen-price");
    const color = document.getElementById("chosen-color");
    const label = document.getElementById("chosen-variant");

    function updateVariant() {
      const option = variantSelect.options[variantSelect.selectedIndex];
      if (!option || !option.value) {
        price.textContent = "";
        label.textContent = "Select a size and color";
        color.style.background = "transparent";
        return;
      }
      price.textContent = "$" + option.dataset.price;
      label.textContent = option.textContent.split(" · ").slice(0, 2).join(" · ");
      color.style.background = option.dataset.color;
    }
    variantSelect.addEventListener("change", updateVariant);
    updateVariant();
  }

  const paymentRadios = document.querySelectorAll('input[name="payment_method"]');
  const airtelBox = document.querySelector(".airtel-phone");
  const airtelInput = airtelBox ? airtelBox.querySelector("input") : null;
  function updatePaymentFields() {
    const selected = document.querySelector('input[name="payment_method"]:checked');
    const showAirtel = selected && selected.value === "airtel_money";
    if (airtelBox) airtelBox.classList.toggle("hidden", !showAirtel);
    if (airtelInput) airtelInput.required = Boolean(showAirtel);
  }
  paymentRadios.forEach(radio => radio.addEventListener("change", updatePaymentFields));
  updatePaymentFields();

  const addVariantButton = document.getElementById("add-variant");
  const variantRows = document.getElementById("variant-rows");
  const variantsInput = document.getElementById("variants-json");
  const productForm = document.getElementById("product-editor");

  if (addVariantButton && variantRows && variantsInput && productForm) {
    let variants = Array.isArray(window.initialVariants) ? window.initialVariants : [];

    function makeInput(className, value, type = "text", placeholder = "") {
      const input = document.createElement("input");
      input.className = className;
      input.type = type;
      input.value = value ?? "";
      input.placeholder = placeholder;
      if (type === "number") {
        input.min = "0";
        input.step = className === "variant-price" ? "0.01" : "1";
      }
      return input;
    }

    function renderVariants() {
      variantRows.innerHTML = "";
      variants.forEach((variant, index) => {
        const row = document.createElement("div");
        row.className = "variant-editor-row";
        row.dataset.index = index;
        row.append(
          makeInput("variant-size", variant.size, "text", "M / XL"),
          makeInput("variant-color", variant.color_name, "text", "Black"),
          makeInput("variant-hex", variant.color_hex || "#222222", "color"),
          makeInput("variant-price", variant.price, "number", "25.00"),
          makeInput("variant-stock", variant.stock_quantity, "number", "10"),
          makeInput("variant-sku", variant.sku, "text", "SKU-001")
        );
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-variant";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove variant");
        remove.addEventListener("click", () => {
          variants.splice(index, 1);
          renderVariants();
        });
        row.append(remove);
        row.querySelector(".variant-size").addEventListener("input", e => variant.size = e.target.value);
        row.querySelector(".variant-color").addEventListener("input", e => variant.color_name = e.target.value);
        row.querySelector(".variant-hex").addEventListener("input", e => variant.color_hex = e.target.value);
        row.querySelector(".variant-price").addEventListener("input", e => variant.price = e.target.value);
        row.querySelector(".variant-stock").addEventListener("input", e => variant.stock_quantity = e.target.value);
        row.querySelector(".variant-sku").addEventListener("input", e => variant.sku = e.target.value);
        variantRows.append(row);
      });
    }

    addVariantButton.addEventListener("click", () => {
      variants.push({ size: "M", color_name: "Black", color_hex: "#222222", price: "0.00", stock_quantity: 0, sku: "" });
      renderVariants();
    });

    productForm.addEventListener("submit", event => {
      variants = variants.filter(v => v.size && v.color_name && v.color_hex && v.price !== "");
      if (!variants.length) {
        event.preventDefault();
        alert("Add at least one size/color variant.");
        return;
      }
      variantsInput.value = JSON.stringify(variants);
    });

    if (!variants.length) {
      variants.push({ size: "M", color_name: "Black", color_hex: "#222222", price: "0.00", stock_quantity: 0, sku: "" });
    }
    renderVariants();
  }
});


// Appliquer le thème choisi dans les paramètres du compte.
document.addEventListener("DOMContentLoaded", () => {
  const html = document.documentElement;
  const theme = html.dataset.theme || "system";

  if (theme === "dark") {
    html.classList.add("theme-dark");
  } else if (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.classList.add("theme-dark");
  }

  const notice = document.getElementById("cookie-notice");
  const acceptButton = document.getElementById("accept-cookies");

  if (notice && !localStorage.getItem("Ecrin d'art d'amina-cookie-choice")) {
    notice.hidden = false;
  }

  if (acceptButton && notice) {
    acceptButton.addEventListener("click", () => {
      localStorage.setItem("Ecrin d'art d'amina-cookie-choice", "accepted");
      notice.hidden = true;
    });
  }
});

//HERO CAROUSSEL

const slides = document.querySelectorAll(".hero-slide");
const dots = document.querySelectorAll(".carousel-dot");

const nextButton = document.querySelector(".carousel-arrow.next");
const previousButton = document.querySelector(".carousel-arrow.prev");

let currentSlide = 0;
let carouselTimer;


function showSlide(index) {
    slides.forEach(function (slide) {
        slide.classList.remove("active");
    });

    dots.forEach(function (dot) {
        dot.classList.remove("active");
    });

    slides[index].classList.add("active");

    if (dots[index]) {
        dots[index].classList.add("active");
    }

    currentSlide = index;
}


function nextSlide() {
    const next = (currentSlide + 1) % slides.length;
    showSlide(next);
}


function previousSlide() {
    const previous =
        (currentSlide - 1 + slides.length) % slides.length;

    showSlide(previous);
}


function startCarousel() {
    clearInterval(carouselTimer);

    if (slides.length > 1) {
        carouselTimer = setInterval(nextSlide, 5000);
    }
}


if (slides.length > 0) {
    if (nextButton) {
        nextButton.addEventListener("click", function () {
            nextSlide();
            startCarousel();
        });
    }

    if (previousButton) {
        previousButton.addEventListener("click", function () {
            previousSlide();
            startCarousel();
        });
    }

    dots.forEach(function (dot, index) {
        dot.addEventListener("click", function () {
            showSlide(index);
            startCarousel();
        });
    });

    startCarousel();
}

// Masquer l'image de livraison au clic
const livraisonBtn = document.getElementById("livraison");

if (livraisonBtn) {
    livraisonBtn.addEventListener("click", function () {
        livraisonBtn.style.display = "none";
        console.log("Image de livraison masquée");
    });
}

//hide authSection
let authSection = document.getElementById("auth-section");
const authBtn = document.getElementById("hideAuthSection");

authBtn.addEventListener("click", function () {
    authSection.style.display = "none";
    console.log("auth section hidden");
});

//price conversion

document.addEventListener("DOMContentLoaded", () => {
    const variantSelect = document.querySelector("#variant");
    const productPrice = document.querySelector("#product-price");

    if (!variantSelect || !productPrice) return;

    const currency = productPrice.dataset.currency;

    function updatePrice() {
        const selectedOption = variantSelect.selectedOptions[0];

        if (!selectedOption || !selectedOption.value) return;

        const price = currency === "CDF"
            ? selectedOption.dataset.priceCdf
            : selectedOption.dataset.price;

        const formattedPrice = new Intl.NumberFormat("fr-FR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(price));

        productPrice.textContent =
            `${formattedPrice} ${currency === "CDF" ? "FC" : "$"}`;
    }

    variantSelect.addEventListener("change", updatePrice);

    updatePrice();
});