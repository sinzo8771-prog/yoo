import { cn } from "@/lib/utils"
import React from "react"

import { ProductImage } from "@/components/media/ProductImage"
import PlaceholderImage from "@/features/storefront/modules/common/icons/placeholder-image"

type ThumbnailProps = {
  thumbnail?: string | null;
  images?: any[] | null;
  size?: "small" | "medium" | "large" | "full" | "square";
  isFeatured?: boolean;
  className?: string;
  /**
   * Task 20, step 4: alt text is opt-in. An empty alt is correct wherever the
   * surrounding link or heading already names the product (store grid, cart,
   * order history); those surfaces used to announce "Thumbnail" for every single
   * item. Pass a title only when the image is the sole label of a link.
   */
  alt?: string;
  "data-testid"?: string;
};

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  className,
  alt = "",
  "data-testid": dataTestid,
}) => {
  const initialImage =
    thumbnail ||
    images?.[0]?.url ||
    images?.[0]?.image?.url ||
    images?.[0]?.imagePath ||
    "/images/placeholder.svg";

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden p-4 bg-muted shadow-sm rounded-lg group-hover:shadow-md transition-shadow ease-in-out duration-150",
        className,
        {
          "aspect-[11/14]": isFeatured,
          "aspect-[9/16]": !isFeatured && size !== "square",
          "aspect-[1/1]": size === "square",
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      <ImageOrPlaceholder image={initialImage} size={size} alt={alt} />
    </div>
  )
}

const ImageOrPlaceholder = ({
  image,
  size,
  alt,
}: Pick<ThumbnailProps, "size"> & { image?: string; alt: string }) => {
  return image ? (
    <ProductImage
      src={image}
      alt={alt}
      className="object-cover object-center"
      sizes="(max-width: 576px) 50vw, (max-width: 768px) 33vw, (max-width: 992px) 25vw, 20vw"
    />
  ) : (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center">
      <PlaceholderImage size={size === "small" ? 16 : 24} />
    </div>
  )
}

export default Thumbnail
